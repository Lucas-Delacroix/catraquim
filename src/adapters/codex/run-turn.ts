import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { CodexAppServerClient } from './app-server.js';
import type { CodexRpcNotificationMessage } from './types.js';

export interface TurnResult {
  text: string;
}

interface CodexTurn {
  id: string;
  status: string;
  items?: Array<Record<string, unknown>>;
  error?: unknown;
}

function extractTurnErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error) as {
        error?: { message?: string };
        message?: string;
      };
      return parsed.error?.message ?? parsed.message ?? error;
    } catch {
      return error;
    }
  }

  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;

  if (typeof record.message === 'string') {
    try {
      const parsed = JSON.parse(record.message) as {
        error?: { message?: string };
        message?: string;
      };
      return parsed.error?.message ?? parsed.message ?? record.message;
    } catch {
      return record.message;
    }
  }

  return undefined;
}

function errorForTurnStatus(turn: CodexTurn): AppError {
  if (turn.status === 'failed') {
    return new AppError(
      extractTurnErrorMessage(turn.error) ?? 'Codex turn failed',
      400,
      turn.error
    );
  }

  if (turn.status === 'interrupted') {
    return new AppError('Codex turn interrupted', 499, turn.error);
  }

  return new AppError(
    `Unexpected Codex turn status: ${turn.status}`,
    502,
    turn
  );
}

function isTerminalFailureStatus(status: string): boolean {
  return status === 'failed' || status === 'interrupted';
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

  const record = value as Record<string, unknown>;

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

// Extract assistant text from a CodexTurn's items array.
// Agent text output arrives in items of type "agentMessage".
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

// Extract incremental text from threadItem/* streaming notifications.
function extractDeltaText(msg: CodexRpcNotificationMessage): string {
  const params = msg.params as Record<string, unknown> | undefined;
  if (!params) return '';
  return extractTextFragments(params).join('');
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

  // Populated once turn/start responds; used for interrupt and correlation.
  let turnId: string | undefined;

  return new Promise((resolve, reject) => {
    const texts: string[] = [];

    const removeListener = client.onNotification(
      (msg: CodexRpcNotificationMessage) => {
        const params = msg.params as Record<string, unknown> | undefined;

        // Drop notifications for a different thread
        if (params?.threadId !== undefined && params.threadId !== threadId) {
          return;
        }

        // Accumulate incremental text from streaming notifications
        const delta = extractDeltaText(msg);
        if (delta) texts.push(delta);

        if (msg.method === 'turn/completed') {
          // Also filter by turnId once we have it
          if (
            turnId !== undefined &&
            params?.turnId !== undefined &&
            params.turnId !== turnId
          ) {
            return;
          }

          const turn = params?.turn as CodexTurn | undefined;
          if (turn && isTerminalFailureStatus(turn.status)) {
            removeListener();
            signal.removeEventListener('abort', handleAbort);
            reject(errorForTurnStatus(turn));
            return;
          }

          const finalText = extractTurnItemsText(turn?.items);
          if (finalText) texts.push(finalText);
          if (!finalText && texts.length === 0) {
            logger.warn(
              { params, threadId, turnId },
              'Codex turn/completed notification had no extractable assistant text'
            );
          }

          removeListener();
          signal.removeEventListener('abort', handleAbort);
          resolve({ text: texts.join('') });
        }
      }
    );

    const handleAbort = () => {
      removeListener();
      client.notify('turn/interrupt', { threadId, turnId }).catch(() => {});
      reject(new AppError('Turn aborted', 499));
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

        // Terminal response: server completed the turn without streaming
        if (isTerminalFailureStatus(turn.status)) {
          removeListener();
          signal.removeEventListener('abort', handleAbort);
          reject(errorForTurnStatus(turn));
          return;
        }

        if (turn.status !== 'completed') {
          return;
        }

        const finalText = extractTurnItemsText(turn.items);
        if (finalText) texts.push(finalText);
        if (!finalText && texts.length === 0) {
          logger.warn(
            { threadId, turnId, turn },
            'Codex turn completed without extractable assistant text'
          );
        }

        removeListener();
        signal.removeEventListener('abort', handleAbort);
        resolve({ text: texts.join('') });
      })
      .catch((err: Error) => {
        removeListener();
        signal.removeEventListener('abort', handleAbort);
        reject(err);
      });
  });
}
