import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, resolvedConfigPaths } from '../src/config/loader.js';

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalConfigEnv = process.env.CATRAQUIM_CONFIG;
const originalCodexBinaryEnv = process.env.CATRAQUIM_CODEX_BINARY;
const originalPortEnv = process.env.CATRAQUIM_PORT;
const originalTokenEnv = process.env.CATRAQUIM_TOKEN;

const createTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'catraquim-loader-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  process.chdir(originalCwd);

  if (originalConfigEnv === undefined) {
    process.env.CATRAQUIM_CONFIG = undefined;
  } else {
    process.env.CATRAQUIM_CONFIG = originalConfigEnv;
  }

  if (originalCodexBinaryEnv === undefined) {
    process.env.CATRAQUIM_CODEX_BINARY = undefined;
  } else {
    process.env.CATRAQUIM_CODEX_BINARY = originalCodexBinaryEnv;
  }

  if (originalPortEnv === undefined) {
    process.env.CATRAQUIM_PORT = undefined;
  } else {
    process.env.CATRAQUIM_PORT = originalPortEnv;
  }

  if (originalTokenEnv === undefined) {
    process.env.CATRAQUIM_TOKEN = undefined;
  } else {
    process.env.CATRAQUIM_TOKEN = originalTokenEnv;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('config loader', () => {
  it('loads config.json from the current working directory', () => {
    process.env.CATRAQUIM_CONFIG = undefined;

    const dir = createTempDir();
    const filePath = join(dir, 'config.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        models: {
          'gpt-5': {
            adapter: 'codex',
            upstreamModel: 'codex-max',
          },
        },
      }),
      'utf8'
    );

    process.chdir(dir);

    const config = loadConfig();

    expect(config.models['gpt-5']).toEqual({
      adapter: 'codex',
      upstreamModel: 'codex-max',
    });
    expect(resolvedConfigPaths()).toContain(filePath);
  });

  it('prefers CATRAQUIM_CONFIG when explicitly set', () => {
    const dir = createTempDir();
    const configDir = join(dir, 'nested');
    const explicitPath = join(configDir, 'gateway.json');
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      explicitPath,
      JSON.stringify({
        server: {
          port: 5151,
        },
      }),
      'utf8'
    );

    process.env.CATRAQUIM_CONFIG = explicitPath;

    const config = loadConfig();

    expect(config.server.port).toBe(5151);
    expect(resolvedConfigPaths()).toEqual([explicitPath]);
  });

  it('accepts the legacy top-level codex config shape', () => {
    process.env.CATRAQUIM_CONFIG = undefined;

    const dir = createTempDir();
    const filePath = join(dir, 'config.json');

    writeFileSync(
      filePath,
      JSON.stringify({
        codex: {
          binary: 'custom-codex',
          codexHomeSource: '~/legacy-codex',
        },
      }),
      'utf8'
    );

    process.chdir(dir);

    const config = loadConfig();

    expect(config.providers.codex).toEqual({
      type: 'codex',
      binary: 'custom-codex',
      homePath: expect.stringContaining('legacy-codex'),
    });
  });

  it('applies env overrides after merging file config', () => {
    const dir = createTempDir();
    const configDir = join(dir, 'nested');
    const explicitPath = join(configDir, 'gateway.json');
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      explicitPath,
      JSON.stringify({
        providers: {
          codex: {
            type: 'codex',
            binary: 'custom-codex',
            homePath: '~/.custom-codex',
          },
        },
        server: {
          port: 5151,
          token: 'from-file',
        },
      }),
      'utf8'
    );

    process.env.CATRAQUIM_CONFIG = explicitPath;
    process.env.CATRAQUIM_CODEX_BINARY = 'env-codex';
    process.env.CATRAQUIM_PORT = '6161';
    process.env.CATRAQUIM_TOKEN = 'from-env';

    const config = loadConfig();

    expect(config.providers.codex.binary).toBe('env-codex');
    expect(config.providers.codex.homePath).toContain('.custom-codex');
    expect(config.server.port).toBe(6161);
    expect(config.server.token).toBe('from-env');
  });

  it('rejects ports outside the TCP range', () => {
    const dir = createTempDir();
    const explicitPath = join(dir, 'config.json');

    writeFileSync(
      explicitPath,
      JSON.stringify({
        server: {
          port: 70_000,
        },
      }),
      'utf8'
    );

    process.env.CATRAQUIM_CONFIG = explicitPath;

    expect(() => loadConfig()).toThrow(/Too big/);
  });

  it('rejects model aliases that reference unknown providers', () => {
    const dir = createTempDir();
    const explicitPath = join(dir, 'config.json');

    writeFileSync(
      explicitPath,
      JSON.stringify({
        models: {
          broken: {
            adapter: 'missing-provider',
            upstreamModel: 'gpt-5',
          },
        },
      }),
      'utf8'
    );

    process.env.CATRAQUIM_CONFIG = explicitPath;

    expect(() => loadConfig()).toThrow(/broken.*missing-provider/);
  });

  it('rejects non-loopback hosts without a bearer token', () => {
    const dir = createTempDir();
    const explicitPath = join(dir, 'config.json');

    writeFileSync(
      explicitPath,
      JSON.stringify({
        server: {
          host: '0.0.0.0',
          token: null,
        },
      }),
      'utf8'
    );

    process.env.CATRAQUIM_CONFIG = explicitPath;

    expect(() => loadConfig()).toThrow(
      /server\.token is required when server\.host is not loopback/
    );
  });
});
