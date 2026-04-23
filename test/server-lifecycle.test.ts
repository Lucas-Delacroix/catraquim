import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultConfig } from '../src/config/defaults.js';

const mockServe = vi.fn();
const shutdownSpy = vi.fn();
const createProvidersMock = vi.hoisted(() => vi.fn());

vi.mock('@hono/node-server', () => ({
  serve: mockServe,
}));

vi.mock('../src/application/provider-factory.js', () => ({
  ProviderFactory: vi.fn().mockImplementation(() => ({
    create: createProvidersMock,
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
    createProvidersMock.mockReturnValue([
      {
        chat: async function* () {},
        id: 'codex',
        shutdown: shutdownSpy,
        status: async () => ({
          id: 'codex',
          ok: true,
        }),
      },
    ]);

    const { startServer } = await import('../src/server.js');

    startServer(defaultConfig);
    process.emit('SIGTERM', 'SIGTERM');

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
