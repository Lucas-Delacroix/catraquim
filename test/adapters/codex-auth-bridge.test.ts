import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mockHome = vi.hoisted(() => ({ value: '' }));
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => mockHome.value,
  };
});

vi.mock('../../src/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  gatewayCodexHome,
  prepareCodexHome,
} from '../../src/adapters/codex/auth-bridge.js';

const tempDirs: string[] = [];

const createMockHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'catraquim-codex-home-'));
  tempDirs.push(home);
  mockHome.value = home;
  return home;
};

afterEach(() => {
  loggerWarnMock.mockClear();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('Codex auth bridge', () => {
  it('copies auth.json from an expanded source home into the gateway home', () => {
    const home = createMockHome();
    const source = join(home, 'source-codex-home');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'auth.json'), '{"token":"secret"}', 'utf8');

    const target = prepareCodexHome('~/source-codex-home');

    expect(target).toBe(gatewayCodexHome());
    expect(readFileSync(join(target, 'auth.json'), 'utf8')).toBe(
      '{"token":"secret"}'
    );
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('warns and still prepares the gateway home when source auth is missing', () => {
    const home = createMockHome();

    const target = prepareCodexHome('~');

    expect(target).toBe(gatewayCodexHome());
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { srcAuth: join(home, 'auth.json') },
      'Codex auth.json not found at source'
    );
  });
});
