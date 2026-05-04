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
  formatSetupExamples,
  initConfig,
  setupConfig,
  validateConfig,
} from '../src/config/manage.js';

const tempDirs: string[] = [];
const serializedDefaultConfig = () => ({
  ...defaultConfig,
  models: Object.fromEntries(
    Object.entries(defaultConfig.models).map(([alias, model]) => [
      alias,
      `${model.adapter}/${model.upstreamModel}`,
    ])
  ),
});

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
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(
      serializedDefaultConfig()
    );
    expect(validateConfig(filePath).config.providers['claude-code'].type).toBe(
      'claude-code'
    );
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
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(
      serializedDefaultConfig()
    );
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

  it('documents sensible setup examples for Codex and Claude Code', () => {
    const examples = formatSetupExamples();

    expect(examples).toContain('Provider type: codex');
    expect(examples).toContain('Codex home: ~/.codex');
    expect(examples).toContain('codex/gpt-5.4');
    expect(examples).toContain('Provider type: claude-code');
    expect(examples).toContain('Claude Code home: ~/.claude');
    expect(examples).toContain('claude-code/claude-sonnet-4-6');
  });

  it('writes a config file from interactive answers', async () => {
    const filePath = createTempPath();
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const result = await setupConfig({
      filePath,
      promptApi: {
        ask: vi
          .fn()
          .mockResolvedValueOnce('0.0.0.0')
          .mockResolvedValueOnce('5151')
          .mockResolvedValueOnce('test-token')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('~/.codex')
          .mockResolvedValueOnce('gpt-5')
          .mockResolvedValueOnce('gpt-5.4')
          .mockResolvedValueOnce('gpt-5-mini')
          .mockResolvedValueOnce('codex/gpt-5.4-mini'),
        close: vi.fn(),
        confirm,
      },
    });

    expect(result).toEqual({
      cancelled: false,
      created: true,
      filePath,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      models: {
        'gpt-5': 'codex/gpt-5.4',
        'gpt-5-mini': 'codex/gpt-5.4-mini',
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
        token: 'test-token',
      },
    });
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      'Configure a second model',
      true
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      `Write config to ${filePath}`,
      true
    );
  });

  it('rejects malformed canonical model references during setup', async () => {
    const filePath = createTempPath();
    const close = vi.fn();

    await expect(
      setupConfig({
        filePath,
        promptApi: {
          ask: vi
            .fn()
            .mockResolvedValueOnce('127.0.0.1')
            .mockResolvedValueOnce('4141')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('~/.codex')
            .mockResolvedValueOnce('codex-max')
            .mockResolvedValueOnce('codex/'),
          close,
          confirm: vi.fn(),
        },
      })
    ).rejects.toThrow(/Invalid canonical model "codex\/"/);

    expect(close).toHaveBeenCalledOnce();
    expect(() => readFileSync(filePath, 'utf8')).toThrow();
  });

  it('rejects duplicate model aliases during setup', async () => {
    const filePath = createTempPath();
    const close = vi.fn();

    await expect(
      setupConfig({
        filePath,
        promptApi: {
          ask: vi
            .fn()
            .mockResolvedValueOnce('127.0.0.1')
            .mockResolvedValueOnce('4141')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('~/.codex')
            .mockResolvedValueOnce('codex-max')
            .mockResolvedValueOnce('codex/gpt-5.4')
            .mockResolvedValueOnce('codex-max')
            .mockResolvedValueOnce('codex/gpt-5.4-mini'),
          close,
          confirm: vi.fn().mockResolvedValueOnce(true),
        },
      })
    ).rejects.toThrow(/Model aliases must be different/);

    expect(close).toHaveBeenCalledOnce();
    expect(() => readFileSync(filePath, 'utf8')).toThrow();
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
          .mockResolvedValueOnce('codex')
          .mockResolvedValueOnce('~/.codex')
          .mockResolvedValueOnce('codex-max')
          .mockResolvedValueOnce('codex/gpt-5.4'),
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

  it('rejects interactive setup ports outside the TCP range', async () => {
    const filePath = createTempPath();
    const close = vi.fn();

    await expect(
      setupConfig({
        filePath,
        promptApi: {
          ask: vi
            .fn()
            .mockResolvedValueOnce('127.0.0.1')
            .mockResolvedValueOnce('70000'),
          close,
          confirm: vi.fn(),
        },
      })
    ).rejects.toThrow(/Invalid port "70000"/);

    expect(close).toHaveBeenCalledOnce();
    expect(() => readFileSync(filePath, 'utf8')).toThrow();
  });

  it('rejects interactive setup for non-loopback hosts without a token', async () => {
    const filePath = createTempPath();
    const close = vi.fn();

    await expect(
      setupConfig({
        filePath,
        promptApi: {
          ask: vi
            .fn()
            .mockResolvedValueOnce('0.0.0.0')
            .mockResolvedValueOnce('5151')
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('codex')
            .mockResolvedValueOnce('~/.codex')
            .mockResolvedValueOnce('gpt-5')
            .mockResolvedValueOnce('codex/gpt-5.4'),
          close,
          confirm: vi.fn().mockResolvedValueOnce(false),
        },
      })
    ).rejects.toThrow(
      /server\.token is required when server\.host is not loopback/
    );

    expect(close).toHaveBeenCalledOnce();
    expect(() => readFileSync(filePath, 'utf8')).toThrow();
  });

  it('uses provider-specific labels and preserves the selected provider type', async () => {
    const filePath = createTempPath();
    const ask = vi
      .fn()
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('4141')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('claude-code')
      .mockResolvedValueOnce('claude-code')
      .mockResolvedValueOnce('claude')
      .mockResolvedValueOnce('~/.claude')
      .mockResolvedValueOnce('claude-sonnet')
      .mockResolvedValueOnce('claude-code/claude-sonnet-4-6');

    const result = await setupConfig({
      filePath,
      promptApi: {
        ask,
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      },
    });

    expect(result.cancelled).toBe(false);
    expect(ask).toHaveBeenNthCalledWith(
      4,
      'Provider type (codex|claude-code)',
      'codex'
    );
    expect(ask).toHaveBeenNthCalledWith(5, 'Provider id', 'claude-code');
    expect(ask).toHaveBeenNthCalledWith(6, 'Claude Code binary', 'claude');
    expect(ask).toHaveBeenNthCalledWith(7, 'Claude Code home', '~/.claude');
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      models: {
        'claude-sonnet': 'claude-code/claude-sonnet-4-6',
      },
      providers: {
        'claude-code': {
          type: 'claude-code',
          binary: 'claude',
          homePath: '~/.claude',
        },
      },
    });
  });

  it('accepts claude as shorthand for the Claude Code provider type', async () => {
    const filePath = createTempPath();

    await setupConfig({
      filePath,
      promptApi: {
        ask: vi
          .fn()
          .mockResolvedValueOnce('127.0.0.1')
          .mockResolvedValueOnce('4141')
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('claude')
          .mockResolvedValueOnce('claude-code')
          .mockResolvedValueOnce('claude')
          .mockResolvedValueOnce('~/.claude')
          .mockResolvedValueOnce('claude-opus')
          .mockResolvedValueOnce('claude-code/claude-opus-4-7'),
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      },
    });

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      providers: {
        'claude-code': {
          type: 'claude-code',
        },
      },
    });
  });

  it('uses recommended codex defaults even when the existing config has stale codex values', async () => {
    const filePath = createTempPath();
    writeFileSync(
      filePath,
      JSON.stringify({
        models: {
          'codex-max': 'codex/codex-max',
          'codex-mini': 'codex/old-mini',
        },
        providers: {
          codex: {
            type: 'codex',
            binary: 'custom-codex',
            homePath: '~/custom-codex',
          },
        },
      }),
      'utf8'
    );

    const ask = vi
      .fn()
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('4141')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('~/.codex')
      .mockResolvedValueOnce('codex-max')
      .mockResolvedValueOnce('codex/gpt-5.4')
      .mockResolvedValueOnce('codex-mini')
      .mockResolvedValueOnce('codex/gpt-5.4-mini');

    await setupConfig({
      filePath,
      promptApi: {
        ask,
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      },
    });

    expect(ask).toHaveBeenNthCalledWith(5, 'Provider id', 'codex');
    expect(ask).toHaveBeenNthCalledWith(6, 'Codex binary', 'codex');
    expect(ask).toHaveBeenNthCalledWith(7, 'Codex home', '~/.codex');
    expect(ask).toHaveBeenNthCalledWith(8, 'Primary model alias', 'codex-max');
    expect(ask).toHaveBeenNthCalledWith(
      9,
      'Primary canonical model',
      'codex/gpt-5.4'
    );
    expect(ask).toHaveBeenNthCalledWith(10, 'Second model alias', 'codex-mini');
    expect(ask).toHaveBeenNthCalledWith(
      11,
      'Second canonical model',
      'codex/gpt-5.4-mini'
    );
  });

  it('uses recommended codex defaults when the existing config has no codex provider', async () => {
    const filePath = createTempPath();
    writeFileSync(
      filePath,
      JSON.stringify({
        providers: {
          codex: {
            type: 'claude-code',
            binary: 'claude',
            homePath: '~/.claude',
          },
        },
      }),
      'utf8'
    );

    const ask = vi
      .fn()
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('4141')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('~/.codex')
      .mockResolvedValueOnce('codex-max')
      .mockResolvedValueOnce('codex/gpt-5.4');

    await setupConfig({
      filePath,
      promptApi: {
        ask,
        close: vi.fn(),
        confirm: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      },
    });

    expect(ask).toHaveBeenNthCalledWith(
      4,
      'Provider type (codex|claude-code)',
      'codex'
    );
    expect(ask).toHaveBeenNthCalledWith(5, 'Provider id', 'codex');
    expect(ask).toHaveBeenNthCalledWith(6, 'Codex binary', 'codex');
    expect(ask).toHaveBeenNthCalledWith(7, 'Codex home', '~/.codex');
  });
});
