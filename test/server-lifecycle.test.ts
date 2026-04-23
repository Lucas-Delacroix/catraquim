import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultConfig } from '../src/config/defaults.js';

const mockServe = vi.fn();
const shutdownSpy = vi.fn();

vi.mock('@hono/node-server', () => ({
  serve: mockServe,
}));

vi.mock('../src/adapters/codex/index.js', () => ({
  CodexAdapter: vi.fn().mockImplementation(() => ({
    chat: async function* () {},
    id: 'codex',
    shutdown: shutdownSpy,
    status: async () => ({
      id: 'codex',
      ok: true,
    }),
    supports: () => true,
  })),
}));

class MockServer extends EventEmitter {
  public close = vi.fn((callback?: (error?: Error) => void) => {
    callback?.();
    this.emit('close');
    return this;
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('startServer lifecycle', () => {
  it('shuts down adapters and closes the HTTP server on SIGTERM', async () => {
    const server = new MockServer();
    mockServe.mockReturnValue(server);

    const { startServer } = await import('../src/server.js');

    startServer(defaultConfig);
    process.emit('SIGTERM', 'SIGTERM');

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
