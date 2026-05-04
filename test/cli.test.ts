import { afterEach, describe, expect, it, vi } from 'vitest';

const editConfigMock = vi.hoisted(() => vi.fn());
const getConfigPathMock = vi.hoisted(() => vi.fn());
const initConfigMock = vi.hoisted(() => vi.fn());
const setupConfigMock = vi.hoisted(() => vi.fn());
const validateConfigMock = vi.hoisted(() => vi.fn());
const createServerContextMock = vi.hoisted(() => vi.fn());
const startServerMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../src/config/manage.js', () => ({
  editConfig: editConfigMock,
  getConfigPath: getConfigPathMock,
  initConfig: initConfigMock,
  setupConfig: setupConfigMock,
  validateConfig: validateConfigMock,
}));

vi.mock('../src/server.js', () => ({
  createServerContext: createServerContextMock,
  startServer: startServerMock,
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { run } from '../src/cli.js';

const ok = (msg: string) => `✓ ${msg}\n`;
const info = (msg: string) => `→ ${msg}\n`;

describe('CLI', () => {
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('prints the config path', async () => {
    getConfigPathMock.mockReturnValue('/tmp/catraquim/config.json');

    await run(['config:path']);

    expect(stdoutSpy).toHaveBeenCalledWith(info('/tmp/catraquim/config.json'));
  });

  it('passes --force to config:init', async () => {
    initConfigMock.mockReturnValue({
      created: false,
      filePath: '/tmp/catraquim/config.json',
    });

    await run(['config:init', '--force']);

    expect(initConfigMock).toHaveBeenCalledWith({ force: true });
    expect(stdoutSpy).toHaveBeenCalledWith(
      ok('Overwrote config file at /tmp/catraquim/config.json')
    );
  });

  it('prints a validation success message', async () => {
    validateConfigMock.mockReturnValue({
      config: {},
      filePath: '/tmp/catraquim/config.json',
    });

    await run(['config:validate']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      ok('Config is valid: /tmp/catraquim/config.json')
    );
  });

  it('prints a creation message when config:edit bootstraps the file', async () => {
    editConfigMock.mockReturnValue({
      created: true,
      filePath: '/tmp/catraquim/config.json',
    });

    await run(['config:edit']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      ok('Created config file at /tmp/catraquim/config.json')
    );
  });

  it('prints a success message when config:setup writes the file', async () => {
    setupConfigMock.mockResolvedValue({
      cancelled: false,
      created: false,
      filePath: '/tmp/catraquim/config.json',
    });

    await run(['config:setup']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      ok('Updated config file at /tmp/catraquim/config.json')
    );
  });

  it('prints a cancellation message when config:setup is aborted', async () => {
    setupConfigMock.mockResolvedValue({
      cancelled: true,
      created: false,
      filePath: '/tmp/catraquim/config.json',
    });

    await run(['config:setup']);

    expect(stdoutSpy).toHaveBeenCalledWith(info('Config setup cancelled'));
  });

  it('prints auth status for the configured adapters', async () => {
    const shutdownMock = vi.fn();
    createServerContextMock.mockReturnValue({
      adapters: [
        {
          id: 'codex',
          shutdown: shutdownMock,
          status: vi.fn().mockResolvedValue({
            expiresAt: '2026-05-01T00:00:00Z',
            id: 'codex',
            ok: true,
          }),
        },
      ],
      getProviderStatuses: {
        execute: vi.fn().mockResolvedValue({
          codex: {
            expiresAt: '2026-05-01T00:00:00Z',
            ok: true,
          },
        }),
      },
    });

    await run(['auth:status']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          codex: {
            expiresAt: '2026-05-01T00:00:00Z',
            ok: true,
          },
        },
        null,
        2
      )}\n`
    );
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });
});
