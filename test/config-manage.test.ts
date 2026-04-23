import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import { defaultConfig } from '../src/config/defaults.js';
import {
  editConfig,
  initConfig,
  setupConfig,
  validateConfig,
} from '../src/config/manage.js';

const tempDirs: string[] = [];

const createTempPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'catraquim-config-'));
  tempDirs.push(dir);
  return join(dir, 'config.json');
};

afterEach(() => {
  vi.clearAllMocks();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('config management', () => {
  it('initializes the config file from defaults', () => {
    const filePath = createTempPath();

    const result = initConfig({ filePath });

    expect(result).toEqual({
      created: true,
      filePath,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(defaultConfig);
  });

  it('does not overwrite an existing config without --force', () => {
    const filePath = createTempPath();
    initConfig({ filePath });

    expect(() => initConfig({ filePath })).toThrow(/already exists/);
  });

  it('validates the merged effective config', () => {
    const filePath = createTempPath();
    writeFileSync(filePath, JSON.stringify({ server: { port: 5151 } }), 'utf8');

    const result = validateConfig(filePath);

    expect(result.filePath).toBe(filePath);
    expect(result.config.server.port).toBe(5151);
    expect(result.config.models).toEqual(defaultConfig.models);
  });

  it('creates the config file and opens it in $EDITOR when editing', () => {
    const filePath = createTempPath();
    spawnSyncMock.mockReturnValue({ signal: null, status: 0 });

    const result = editConfig({
      editor: 'vim',
      filePath,
    });

    expect(result).toEqual({
      created: true,
      filePath,
    });
    expect(spawnSyncMock).toHaveBeenCalledWith('vim', [filePath], {
      stdio: 'inherit',
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(defaultConfig);
  });

  it('fails when $EDITOR is not configured', () => {
    const filePath = createTempPath();

    expect(() =>
      editConfig({
        editor: '',
        filePath,
      })
    ).toThrow(/EDITOR is not set/);
  });

  it('writes a config file from interactive answers', async () => {
    const filePath = createTempPath();

    const result = await setupConfig({
      filePath,
      promptApi: {
        ask: vi
          .fn()
          .mockResolvedValueOnce('0.0.0.0')
          .mockResolvedValueOnce('5151')
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('~/.codex')
          .mockResolvedValueOnce('gpt-5')
          .mockResolvedValueOnce('codex-max')
          .mockResolvedValueOnce('gpt-5-mini')
          .mockResolvedValueOnce('codex-mini'),
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      },
    });

    expect(result).toEqual({
      cancelled: false,
      created: true,
      filePath,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      models: {
        'gpt-5': {
          adapter: 'codex',
          upstreamModel: 'codex-max',
        },
        'gpt-5-mini': {
          adapter: 'codex',
          upstreamModel: 'codex-mini',
        },
      },
      providers: {
        codex: {
          type: 'codex',
          binary: 'codex',
          homePath: '~/.codex',
        },
      },
      server: {
        host: '0.0.0.0',
        port: 5151,
        token: null,
      },
    });
  });

  it('returns cancelled when the interactive setup is aborted at confirmation', async () => {
    const filePath = createTempPath();

    const result = await setupConfig({
      filePath,
      promptApi: {
        ask: vi
          .fn()
          .mockResolvedValueOnce('127.0.0.1')
          .mockResolvedValueOnce('4141')
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('~/.codex')
          .mockResolvedValueOnce('codex-max')
          .mockResolvedValueOnce('codex-max'),
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false),
      },
    });

    expect(result).toEqual({
      cancelled: true,
      created: false,
      filePath,
    });
    expect(() => readFileSync(filePath, 'utf8')).toThrow();
  });
});
