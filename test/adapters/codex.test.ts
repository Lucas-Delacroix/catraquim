import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAppServerClient } from '../../src/adapters/codex/app-server.js';
import { prepareCodexHome } from '../../src/adapters/codex/auth-bridge.js';
import { CodexAdapter } from '../../src/adapters/codex/index.js';
import { runTurn } from '../../src/adapters/codex/run-turn.js';
import {
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
} from '../../src/adapters/codex/types.js';
import { defaultConfig } from '../../src/config/defaults.js';
import * as codexCredentials from '../../src/credentials/codex.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/adapters/codex/auth-bridge.js', () => ({
  gatewayCodexHome: vi.fn(() => '/tmp/mock-codex-home'),
  prepareCodexHome: vi.fn(() => '/tmp/mock-codex-home'),
}));

// ---------------------------------------------------------------------------
// Mock server helpers
// ---------------------------------------------------------------------------

class MockCodexServer extends EventEmitter {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly killed = false;
  readonly pid = 9999;

  private readonly rl: ReturnType<typeof createInterface>;
  private readonly messageHandlers: Array<
    (msg: Record<string, unknown>) => void
  > = [];

  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();

    this.rl = createInterface({ input: this.stdin });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as Record<string, unknown>;
      for (const handler of [...this.messageHandlers]) handler(msg);
    });
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const idx = this.messageHandlers.indexOf(handler);
      if (idx !== -1) this.messageHandlers.splice(idx, 1);
    };
  }

  respond(id: number, result: unknown): void {
    this.stdout.push(`${JSON.stringify({ id, result })}\n`);
  }

  sendNotification(method: string, params?: unknown): void {
    this.stdout.push(`${JSON.stringify({ method, params })}\n`);
  }

  sendRequest(id: number, method: string, params?: unknown): void {
    this.stdout.push(`${JSON.stringify({ id, method, params })}\n`);
  }
}

const mockSpawn = spawn as ReturnType<typeof vi.fn>;
const mockPrepareCodexHome = prepareCodexHome as ReturnType<typeof vi.fn>;

function createPair() {
  const server = new MockCodexServer();
  mockSpawn.mockReturnValue(server);
  mockPrepareCodexHome.mockReturnValue('/tmp/mock-codex-home');

  // userAgent format: "<originator>/<semver>", version must be >= 0.118.0
  server.onMessage((msg) => {
    if (msg.method === 'initialize') {
      server.respond(msg.id as number, { userAgent: 'codex-mock/0.120.0' });
    }
  });

  const client = new CodexAppServerClient(defaultConfig);
  return { client, server };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isRpcResponse', () => {
  it('matches message with id but no method', () => {
    expect(isRpcResponse({ id: 1, result: {} })).toBe(true);
    expect(isRpcResponse({ id: 1, error: { code: -1, message: 'err' } })).toBe(
      true
    );
  });

  it('rejects message with method', () => {
    expect(isRpcResponse({ id: 1, method: 'foo' })).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isRpcResponse(null)).toBe(false);
    expect(isRpcResponse('string')).toBe(false);
  });
});

describe('isRpcRequest', () => {
  it('matches message with id and method', () => {
    expect(isRpcRequest({ id: 1, method: 'thread/start' })).toBe(true);
  });

  it('rejects message without method', () => {
    expect(isRpcRequest({ id: 1, result: {} })).toBe(false);
  });

  it('rejects notification (no id)', () => {
    expect(isRpcRequest({ method: 'turn/completed' })).toBe(false);
  });
});

describe('isRpcNotification', () => {
  it('matches message with method but no id', () => {
    expect(isRpcNotification({ method: 'turn/completed' })).toBe(true);
    expect(isRpcNotification({ method: 'turn/delta', params: {} })).toBe(true);
  });

  it('rejects message with id', () => {
    expect(isRpcNotification({ id: 1, method: 'foo' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Request / response correlation
// ---------------------------------------------------------------------------

describe('CodexAppServerClient – request/response correlation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves the promise with the correct response', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'thread-abc' } });
      }
    });

    const result = await client.request('thread/start', { model: 'gpt-5' });
    expect(result).toEqual({ thread: { id: 'thread-abc' } });
  });

  it('removes OPENAI_API_KEY from child env explicitly', async () => {
    vi.resetAllMocks();
    process.env.OPENAI_API_KEY = 'host-secret';

    const { client, server } = createPair();
    server.onMessage((msg) => {
      if (msg.method === 'ping') {
        server.respond(msg.id as number, {});
      }
    });

    await client.request('ping', {});

    const spawnCall = mockSpawn.mock.calls.at(0);
    const options = spawnCall?.[2] as { env?: NodeJS.ProcessEnv } | undefined;

    expect(options?.env?.CODEX_HOME).toBe('/tmp/mock-codex-home');
    expect('OPENAI_API_KEY' in (options?.env ?? {})).toBe(false);

    process.env.OPENAI_API_KEY = undefined;
  });

  it('rejects on RPC error response', async () => {
    const { client, server } = createPair();

    let capturedId: number | undefined;
    server.onMessage((msg) => {
      if (msg.method === 'ping') capturedId = msg.id as number;
    });

    const requestPromise = client.request('ping', {});
    await new Promise((r) => setTimeout(r, 20));
    server.stdout.push(
      `${JSON.stringify({
        id: capturedId,
        error: { code: -32000, message: 'boom' },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// Server-request default responses
// ---------------------------------------------------------------------------

describe('CodexAppServerClient – server-request default responses', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['item/tool/call', { contentItems: [], success: false }],
    ['item/commandExecution/requestApproval', { decision: 'decline' }],
    ['item/fileChange/requestApproval', { decision: 'decline' }],
    ['item/permissions/requestApproval', { permissions: {}, scope: 'turn' }],
    ['item/tool/requestUserInput', { answers: {} }],
    ['mcpServer/elicitation/request', { action: 'decline' }],
  ])('auto-responds to %s with correct default', async (method, expected) => {
    const { client, server } = createPair();

    // Trigger initialization
    server.onMessage((msg) => {
      if (msg.method === 'ping') server.respond(msg.id as number, {});
    });
    await client.request('ping', {});

    const responses: Array<{ id: number; result: unknown }> = [];
    server.onMessage((msg) => {
      if ('result' in msg && !('method' in msg)) {
        responses.push({ id: msg.id as number, result: msg.result });
      }
    });

    server.sendRequest(42, method, {});
    await new Promise((r) => setTimeout(r, 20));

    const match = responses.find((r) => r.id === 42);
    expect(match?.result).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Full turn flow: thread/start → turn/start → turn/completed
// ---------------------------------------------------------------------------

describe('runTurn – thread/start → turn/start → turn/completed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extracts threadId from thread.id and aggregates delta notifications', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-1' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: { id: 'turn-1', status: 'running' },
        });
        setTimeout(() => {
          server.sendNotification('turn/delta', {
            delta: 'Hello',
            threadId: 'tid-1',
          });
          server.sendNotification('turn/delta', {
            delta: ', world',
            threadId: 'tid-1',
          });
          server.sendNotification('turn/completed', {
            threadId: 'tid-1',
            turnId: 'turn-1',
          });
        }, 10);
      }
    });

    const result = await runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('Hello, world');
  });

  it('resolves from turn/start when it returns status completed with items', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-sync' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: {
            id: 'turn-sync',
            status: 'completed',
            items: [{ type: 'agentMessage', text: 'Instant reply' }],
          },
        });
      }
    });

    const result = await runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('Instant reply');
  });

  it('extracts nested text parts from agentMessage content arrays', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-nested' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: {
            id: 'turn-nested',
            status: 'completed',
            items: [
              {
                type: 'agentMessage',
                content: [
                  { type: 'output_text', text: 'Nested ' },
                  { type: 'output_text', text: 'reply' },
                ],
              },
            ],
          },
        });
      }
    });

    const result = await runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('Nested reply');
  });

  it('rejects when turn/start returns status failed', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-failed' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: {
            id: 'turn-failed',
            status: 'failed',
            error: {
              message:
                '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Model not supported"}}',
            },
            items: [],
          },
        });
      }
    });

    await expect(
      runTurn(
        client,
        { model: 'gpt-5', modelProvider: 'openai' },
        { approvalPolicy: 'never', model: 'gpt-5' },
        new AbortController().signal
      )
    ).rejects.toThrow('Model not supported');
  });

  it('rejects when turn/completed reports failed status', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, {
          thread: { id: 'tid-failed-notify' },
        });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: { id: 'turn-failed-notify', status: 'running' },
        });
        setTimeout(() => {
          server.sendNotification('turn/completed', {
            threadId: 'tid-failed-notify',
            turnId: 'turn-failed-notify',
            turn: {
              id: 'turn-failed-notify',
              status: 'failed',
              error: { message: 'Upstream failed' },
              items: [],
            },
          });
        }, 10);
      }
    });

    await expect(
      runTurn(
        client,
        { model: 'gpt-5', modelProvider: 'openai' },
        { approvalPolicy: 'never', model: 'gpt-5' },
        new AbortController().signal
      )
    ).rejects.toThrow('Upstream failed');
  });

  it('rejects when turn/start returns status interrupted', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-interrupted' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: {
            id: 'turn-interrupted',
            status: 'interrupted',
            items: [],
          },
        });
      }
    });

    await expect(
      runTurn(
        client,
        { model: 'gpt-5', modelProvider: 'openai' },
        { approvalPolicy: 'never', model: 'gpt-5' },
        new AbortController().signal
      )
    ).rejects.toThrow('Codex turn interrupted');
  });

  it('ignores turn/completed for a different threadId', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-mine' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: { id: 'turn-mine', status: 'running' },
        });
        setTimeout(() => {
          server.sendNotification('turn/completed', {
            threadId: 'tid-other',
            turnId: 'turn-other',
          });
          setTimeout(() => {
            server.sendNotification('turn/delta', {
              delta: 'ok',
              threadId: 'tid-mine',
            });
            server.sendNotification('turn/completed', {
              threadId: 'tid-mine',
              turnId: 'turn-mine',
            });
          }, 10);
        }, 10);
      }
    });

    const result = await runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('ok');
  });

  it('ignores turn/completed for a stale turnId within the same thread', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-t' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: { id: 'turn-t', status: 'running' },
        });
        setTimeout(() => {
          // Same thread, wrong turn — must be ignored
          server.sendNotification('turn/completed', {
            threadId: 'tid-t',
            turnId: 'turn-stale',
          });
          setTimeout(() => {
            server.sendNotification('turn/completed', {
              threadId: 'tid-t',
              turnId: 'turn-t',
              turn: {
                id: 'turn-t',
                status: 'completed',
                items: [{ type: 'agentMessage', text: 'correct' }],
              },
            });
          }, 10);
        }, 10);
      }
    });

    const result = await runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('correct');
  });

  it('rejects and sends turn/interrupt with threadId and turnId on abort', async () => {
    const { client, server } = createPair();

    const interrupted: unknown[] = [];
    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { thread: { id: 'tid-abort' } });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, {
          turn: { id: 'turn-abort', status: 'running' },
        });
      }
      if (msg.method === 'turn/interrupt') {
        interrupted.push(msg.params);
      }
    });

    const ac = new AbortController();
    const promise = runTurn(
      client,
      { model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      ac.signal
    );

    await new Promise((r) => setTimeout(r, 20));
    ac.abort();

    await expect(promise).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(interrupted[0]).toMatchObject({
      threadId: 'tid-abort',
      turnId: 'turn-abort',
    });
  });
});

// ---------------------------------------------------------------------------
// CodexAdapter.supports
// ---------------------------------------------------------------------------

describe('CodexAdapter', () => {
  it('supports models mapped to codex in config', () => {
    const adapter = new CodexAdapter(defaultConfig);
    expect(adapter.supports('codex-max')).toBe(true);
    expect(adapter.supports('codex-mini')).toBe(true);
    expect(adapter.supports('missing-model')).toBe(false);
  });

  it('reads auth status from the configured source codex home', async () => {
    const authSpy = vi
      .spyOn(codexCredentials, 'getCodexAuthStatus')
      .mockResolvedValue({
        expiresAt: '2026-01-01T00:00:00Z',
        ok: true,
      });

    const adapter = new CodexAdapter({
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        codex: {
          ...defaultConfig.providers.codex,
          homePath: '~/source-codex-home',
        },
      },
    });

    await expect(adapter.status()).resolves.toEqual({
      expiresAt: '2026-01-01T00:00:00Z',
      id: 'codex',
      message: undefined,
      ok: true,
    });
    expect(authSpy).toHaveBeenCalledWith('~/source-codex-home');
  });
});
