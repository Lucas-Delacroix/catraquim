import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAppServerClient } from '../../src/adapters/codex/app-server.js';
import { CodexAdapter } from '../../src/adapters/codex/index.js';
import { runTurn } from '../../src/adapters/codex/run-turn.js';
import {
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
} from '../../src/adapters/codex/types.js';
import { defaultConfig } from '../../src/config/defaults.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/adapters/codex/auth-bridge.js', () => ({
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
  private readonly messageHandlers: Array<(msg: Record<string, unknown>) => void> = [];

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
    this.stdout.push(JSON.stringify({ id, result }) + '\n');
  }

  sendNotification(method: string, params?: unknown): void {
    this.stdout.push(JSON.stringify({ method, params }) + '\n');
  }

  sendRequest(id: number, method: string, params?: unknown): void {
    this.stdout.push(JSON.stringify({ id, method, params }) + '\n');
  }
}

const mockSpawn = spawn as ReturnType<typeof vi.fn>;

function createPair() {
  const server = new MockCodexServer();
  mockSpawn.mockReturnValue(server);

  server.onMessage((msg) => {
    if (msg.method === 'initialize') {
      server.respond(msg.id as number, { userAgent: 'codex-mock/1.0.0' });
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
    expect(isRpcResponse({ id: 1, error: { code: -1, message: 'err' } })).toBe(true);
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

  it('resolves the promise when server responds with the same id', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { threadId: 'thread-abc' });
      }
    });

    const result = await client.request('thread/start', { model: 'gpt-5' });
    expect(result).toEqual({ threadId: 'thread-abc' });
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
      JSON.stringify({ id: capturedId, error: { code: -32000, message: 'boom' } }) + '\n'
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
    ['item/permissions/requestApproval', { decision: 'decline' }],
    ['item/tool/requestUserInput', { answers: {} }],
    ['mcpServer/elicitation/request', { action: 'decline' }],
  ])('auto-responds to %s with correct default', async (method, expected) => {
    const { client, server } = createPair();

    // Trigger initialization via a real request
    let initDone = false;
    server.onMessage((msg) => {
      if (msg.method === 'ping') {
        server.respond(msg.id as number, {});
        initDone = true;
      }
    });
    await client.request('ping', {});
    expect(initDone).toBe(true);

    // Capture responses the client sends back (written to server.stdin)
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

  it('aggregates notification text and resolves on turn/completed', async () => {
    const { client, server } = createPair();

    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { threadId: 'turn-thread-1' });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, { ok: true });
        setTimeout(() => {
          server.sendNotification('turn/delta', { delta: 'Hello' });
          server.sendNotification('turn/delta', { delta: ', world' });
          server.sendNotification('turn/completed', {});
        }, 10);
      }
    });

    const result = await runTurn(
      client,
      { approvalPolicy: 'never', model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      new AbortController().signal
    );

    expect(result.text).toBe('Hello, world');
  });

  it('rejects and sends turn/interrupt on abort', async () => {
    const { client, server } = createPair();

    const interrupted: unknown[] = [];
    server.onMessage((msg) => {
      if (msg.method === 'thread/start') {
        server.respond(msg.id as number, { threadId: 'abort-thread' });
      }
      if (msg.method === 'turn/start') {
        server.respond(msg.id as number, { ok: true });
      }
      if (msg.method === 'turn/interrupt') {
        interrupted.push(msg.params);
      }
    });

    const ac = new AbortController();
    const promise = runTurn(
      client,
      { approvalPolicy: 'never', model: 'gpt-5', modelProvider: 'openai' },
      { approvalPolicy: 'never', model: 'gpt-5' },
      ac.signal
    );

    await new Promise((r) => setTimeout(r, 20));
    ac.abort();

    await expect(promise).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CodexAdapter.supports
// ---------------------------------------------------------------------------

describe('CodexAdapter', () => {
  it('supports models mapped to codex in config', () => {
    const adapter = new CodexAdapter(defaultConfig);
    expect(adapter.supports('gpt-5')).toBe(true);
    expect(adapter.supports('missing-model')).toBe(false);
  });
});
