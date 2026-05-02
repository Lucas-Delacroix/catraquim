import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { CodexAppServerClient } from './app-server.js';
import {
  type CodexTurn,
  codexLegacyTurnResultSchema,
  codexNestedTurnResultSchema,
  codexRpcThreadStartResultSchema,
  codexTurnCompletedParamsSchema,
} from './rpc-schemas.js';
import type { CodexRpcNotificationMessage } from './types.js';

export interface TurnResult {
  text: string;
}

function parseEmbeddedErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? raw;
  } catch {
    return raw;
  }
}

function extractTurnErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return parseEmbeddedErrorMessage(error);
  }

  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message !== 'string') {
    return undefined;
  }

  return parseEmbeddedErrorMessage(record.message);
}

function errorForTurnStatus(turn: CodexTurn): AppError {
  if (turn.status === 'failed') {
    return AppError.provider(
      extractTurnErrorMessage(turn.error) ?? 'Codex turn failed',
      502,
      turn.error,
      {
        code: 'turn_failed',
      }
    );
  }

  if (turn.status === 'interrupted') {
    return AppError.transient('Codex turn interrupted', 499, turn.error, {
      code: 'turn_interrupted',
    });
  }

  return AppError.provider(
    `Unexpected Codex turn status: ${turn.status}`,
    502,
    turn,
    {
      code: 'unexpected_turn_status',
      details: {
        status: turn.status,
      },
    }
  );
}

function isTerminalFailureStatus(status: string): boolean {
  return status === 'failed' || status === 'interrupted';
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function extractTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFragments(item));
  }

  const record = toRecord(value);
  if (!record) {
    return [];
  }

  if (typeof record.text === 'string') {
    return [record.text];
  }

  if (typeof record.delta === 'string') {
    return [record.delta];
  }

  if ('content' in record) {
    return extractTextFragments(record.content);
  }

  if ('message' in record) {
    return extractTextFragments(record.message);
  }

  return [];
}

function extractTurnItemsText(
  items: Array<Record<string, unknown>> | undefined
): string {
  if (!Array.isArray(items)) return '';

  const agentItems = items.filter((item) => item.type === 'agentMessage');
  const sourceItems = agentItems.length > 0 ? agentItems : items;
  return sourceItems.flatMap((item) => extractTextFragments(item)).join('');
}

function normalizeTurnResponse(raw: unknown): CodexTurn | undefined {
  const nestedTurn = codexNestedTurnResultSchema.safeParse(raw);
  if (nestedTurn.success) {
    return nestedTurn.data.turn;
  }

  const legacy = codexLegacyTurnResultSchema.safeParse(raw);
  if (!legacy.success) {
    return undefined;
  }

  return {
    id: legacy.data.turnId ?? '',
    items: legacy.data.output,
    status: legacy.data.status,
  };
}

function extractDeltaText(msg: CodexRpcNotificationMessage): string {
  const params = toRecord(msg.params);
  if (!params) return '';
  return extractTextFragments(params).join('');
}

function isMatchingThread(
  params: Record<string, unknown> | undefined,
  threadId: string
): boolean {
  return params?.threadId === undefined || params.threadId === threadId;
}

function isMatchingTurn(
  params: Record<string, unknown> | undefined,
  turnId: string | undefined
): boolean {
  return (
    turnId === undefined ||
    params?.turnId === undefined ||
    params.turnId === turnId
  );
}

function pushFinalText(
  texts: string[],
  items: Array<Record<string, unknown>> | undefined
) {
  const finalText = extractTurnItemsText(items);
  if (finalText) {
    texts.push(finalText);
  }

  return finalText;
}

async function startThread(
  client: CodexAppServerClient,
  threadParams: unknown,
  signal: AbortSignal
): Promise<string> {
  const raw = await client.request('thread/start', threadParams, {
    signal,
    timeoutMs: 30_000,
  });
  const parsed = codexRpcThreadStartResultSchema.safeParse(raw);

  if (!parsed.success) {
    throw AppError.provider(
      'Invalid Codex thread/start response',
      502,
      parsed.error,
      { code: 'invalid_thread_start_response' }
    );
  }

  return parsed.data.thread.id;
}

class TurnSession {
  private readonly texts: string[] = [];
  private turnId: string | undefined;
  private removeListener: (() => void) | undefined;
  private settled = false;

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly threadId: string,
    private readonly signal: AbortSignal,
    private readonly resolve: (result: TurnResult) => void,
    private readonly reject: (error: Error) => void
  ) {}

  start(turnBaseParams: unknown): void {
    if (this.signal.aborted) {
      this.handleAbort();
      return;
    }

    this.removeListener = this.client.onNotification((msg) =>
      this.handleNotification(msg)
    );
    this.signal.addEventListener('abort', this.handleAbort, { once: true });

    this.client
      .request(
        'turn/start',
        {
          ...(turnBaseParams as Record<string, unknown>),
          threadId: this.threadId,
        },
        { signal: this.signal, timeoutMs: 30_000 }
      )
      .then((raw) => this.handleTurnStartResponse(raw))
      .catch((error: Error) => this.rejectTurn(error));
  }

  private handleNotification(msg: CodexRpcNotificationMessage): void {
    const params = toRecord(msg.params);
    if (!isMatchingThread(params, this.threadId)) return;

    const delta = extractDeltaText(msg);
    if (delta) this.texts.push(delta);

    if (msg.method !== 'turn/completed') return;
    if (!isMatchingTurn(params, this.turnId)) return;

    const parsedParams = codexTurnCompletedParamsSchema.safeParse(params);
    const turn = parsedParams.success ? parsedParams.data.turn : undefined;
    if (turn && isTerminalFailureStatus(turn.status)) {
      this.rejectTurn(errorForTurnStatus(turn));
      return;
    }

    this.resolveTurn(
      turn?.items,
      { params, threadId: this.threadId, turnId: this.turnId },
      'Codex turn/completed notification had no extractable assistant text'
    );
  }

  private handleTurnStartResponse(raw: unknown): void {
    const turn = normalizeTurnResponse(raw);
    if (!turn) return;

    this.turnId = turn.id;

    if (isTerminalFailureStatus(turn.status)) {
      this.rejectTurn(errorForTurnStatus(turn));
      return;
    }

    if (turn.status !== 'completed') return;

    this.resolveTurn(
      turn.items,
      { threadId: this.threadId, turnId: this.turnId, turn },
      'Codex turn completed without extractable assistant text'
    );
  }

  private handleAbort = (): void => {
    this.client
      .notify('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.turnId,
      })
      .catch(() => {});
    this.rejectTurn(
      AppError.transient('Turn aborted', 499, undefined, {
        code: 'turn_aborted',
      })
    );
  };

  private cleanup(): void {
    this.removeListener?.();
    this.signal.removeEventListener('abort', this.handleAbort);
  }

  private rejectTurn(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.reject(error);
  }

  private resolveTurn(
    items: Array<Record<string, unknown>> | undefined,
    context: Record<string, unknown>,
    emptyTextWarning: string
  ): void {
    if (this.settled) return;
    this.settled = true;

    const finalText = pushFinalText(this.texts, items);
    if (!finalText && this.texts.length === 0) {
      logger.warn(context, emptyTextWarning);
    }

    this.cleanup();
    this.resolve({ text: this.texts.join('') });
  }
}

export async function runTurn(
  client: CodexAppServerClient,
  threadParams: unknown,
  turnBaseParams: unknown,
  signal: AbortSignal
): Promise<TurnResult> {
  const threadId = await startThread(client, threadParams, signal);

  return new Promise((resolve, reject) => {
    const session = new TurnSession(client, threadId, signal, resolve, reject);
    session.start(turnBaseParams);
  });
}
