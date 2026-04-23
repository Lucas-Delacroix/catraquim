import { AppError } from '../../errors.js';
import type { CodexAppServerClient } from './app-server.js';
import type { CodexRpcNotificationMessage } from './types.js';

export interface TurnResult {
  text: string;
}

function extractText(msg: CodexRpcNotificationMessage): string {
  const params = msg.params as Record<string, unknown> | undefined;
  if (!params) return '';

  if (typeof params.text === 'string') return params.text;
  if (typeof params.delta === 'string') return params.delta;
  if (typeof params.content === 'string') return params.content;

  const item = params.item as Record<string, unknown> | undefined;
  if (item) {
    if (typeof item.text === 'string') return item.text;
    if (typeof item.content === 'string') return item.content;
  }

  return '';
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
  })) as { threadId: string };

  const { threadId } = threadResult;

  return new Promise((resolve, reject) => {
    const texts: string[] = [];

    const removeListener = client.onNotification(
      (msg: CodexRpcNotificationMessage) => {
        const text = extractText(msg);
        if (text) texts.push(text);

        if (msg.method === 'turn/completed') {
          removeListener();
          resolve({ text: texts.join('') });
        }
      }
    );

    const handleAbort = () => {
      removeListener();
      client.notify('turn/interrupt', { threadId }).catch(() => {});
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
      .catch((err: Error) => {
        removeListener();
        signal.removeEventListener('abort', handleAbort);
        reject(err);
      });
  });
}
