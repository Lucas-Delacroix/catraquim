import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { CodexAppServerClient } from './app-server.js';
import type { CodexRpcNotificationMessage } from './types.js';

export interface TurnResult {
  text: string;
}

interface CodexTurn {
  error?: unknown;
  id: string;
  items?: Array<Record<string, unknown>>;
  status: string;
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

  if (typeof value !== 'object' || value === null) {
    return [];
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
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  const nestedTurn = (raw as { turn?: CodexTurn }).turn;
  if (nestedTurn) {
    return nestedTurn;
  }

  const legacy = raw as {
    output?: Array<Record<string, unknown>>;
    status?: string;
    turnId?: string;
  };

  if (typeof legacy.status !== 'string') {
    return undefined;
  }

  return {
    id: legacy.turnId ?? '',
    items: legacy.output,
    status: legacy.status,
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

export async function runTurn(
  client: CodexAppServerClient,
  threadParams: Record<string, unknown>,
  turnBaseParams: Record<string, unknown>,
  signal: AbortSignal
): Promise<TurnResult> {
  const threadResult = (await client.request('thread/start', threadParams, {
    signal,
    timeoutMs: 30_000,
  })) as { thread: { id: string } };

  const threadId = threadResult.thread.id;
  let turnId: string | undefined;

  return new Promise((resolve, reject) => {
    const texts: string[] = [];

    const cleanup = () => {
      removeListener();
      signal.removeEventListener('abort', handleAbort);
    };

    const rejectTurn = (error: Error) => {
      cleanup();
      reject(error);
    };

    const resolveTurn = (
      items: Array<Record<string, unknown>> | undefined,
      context: Record<string, unknown>,
      emptyTextWarning: string
    ) => {
      const finalText = pushFinalText(texts, items);
      if (!finalText && texts.length === 0) {
        logger.warn(context, emptyTextWarning);
      }

      cleanup();
      resolve({ text: texts.join('') });
    };

    const removeListener = client.onNotification((msg) => {
      const params = toRecord(msg.params);

      if (!isMatchingThread(params, threadId)) {
        return;
      }

      const delta = extractDeltaText(msg);
      if (delta) texts.push(delta);

      if (msg.method !== 'turn/completed') {
        return;
      }

      if (!isMatchingTurn(params, turnId)) {
        return;
      }

      const turn = params?.turn as CodexTurn | undefined;
      if (turn && isTerminalFailureStatus(turn.status)) {
        rejectTurn(errorForTurnStatus(turn));
        return;
      }

      resolveTurn(
        turn?.items,
        { params, threadId, turnId },
        'Codex turn/completed notification had no extractable assistant text'
      );
    });

    const handleAbort = () => {
      client.notify('turn/interrupt', { threadId, turnId }).catch(() => {});
      rejectTurn(
        AppError.transient('Turn aborted', 499, undefined, {
          code: 'turn_aborted',
        })
      );
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });

    client
      .request(
        'turn/start',
        { ...turnBaseParams, threadId },
        { signal, timeoutMs: 30_000 }
      )
      .then((raw) => {
        const turn = normalizeTurnResponse(raw);
        if (!turn) return;

        turnId = turn.id;

        if (isTerminalFailureStatus(turn.status)) {
          rejectTurn(errorForTurnStatus(turn));
          return;
        }

        if (turn.status !== 'completed') {
          return;
        }

        resolveTurn(
          turn.items,
          { threadId, turnId, turn },
          'Codex turn completed without extractable assistant text'
        );
      })
      .catch((error: Error) => {
        rejectTurn(error);
      });
  });
}
