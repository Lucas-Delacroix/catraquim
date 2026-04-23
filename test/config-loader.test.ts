import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, resolvedConfigPaths } from '../src/config/loader.js';

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalConfigEnv = process.env.CATRAQUIM_CONFIG;

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
});
