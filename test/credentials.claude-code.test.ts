import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const readMacOsKeychainSecretMock = vi.hoisted(() => vi.fn());

vi.mock('../src/credentials/keychain.js', () => ({
  readMacOsKeychainSecret: readMacOsKeychainSecretMock,
}));

import { getClaudeCodeAuthStatus } from '../src/credentials/claude-code.js';

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'catraquim-claude-credentials-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.clearAllMocks();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('getClaudeCodeAuthStatus', () => {
  it('uses valid Claude Code OAuth credentials from the macOS keychain first', async () => {
    readMacOsKeychainSecretMock.mockResolvedValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-token',
          expiresAt: '2030-01-01T00:00:00Z',
        },
      })
    );

    await expect(getClaudeCodeAuthStatus('/missing')).resolves.toEqual({
      expiresAt: '2030-01-01T00:00:00.000Z',
      ok: true,
    });
    expect(readMacOsKeychainSecretMock).toHaveBeenCalledWith(
      'Claude Code-credentials'
    );
  });

  it('falls back to file credentials when keychain JSON is invalid', async () => {
    const dir = createTempDir();
    readMacOsKeychainSecretMock.mockResolvedValue('{not json');
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-token',
          expiresAt: '1893456000000',
        },
      }),
      'utf8'
    );

    await expect(getClaudeCodeAuthStatus(dir)).resolves.toEqual({
      expiresAt: '2030-01-01T00:00:00.000Z',
      ok: true,
    });
  });

  it('falls back to file credentials when keychain has no access token', async () => {
    const dir = createTempDir();
    readMacOsKeychainSecretMock.mockResolvedValue(
      JSON.stringify({ claudeAiOauth: { expiresAt: '2030-01-01T00:00:00Z' } })
    );
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-token',
          expiresAt: '1893456000000',
        },
      }),
      'utf8'
    );

    await expect(getClaudeCodeAuthStatus(dir)).resolves.toEqual({
      expiresAt: '2030-01-01T00:00:00.000Z',
      ok: true,
    });
  });

  it('reports missing file credentials when neither keychain nor file auth is available', async () => {
    const dir = createTempDir();
    readMacOsKeychainSecretMock.mockResolvedValue(null);

    await expect(getClaudeCodeAuthStatus(dir)).resolves.toEqual({
      expiresAt: null,
      message: `Missing Claude Code credentials file at ${join(
        dir,
        '.credentials.json'
      )}`,
      ok: false,
    });
  });

  it('reports file credentials without an access token', async () => {
    const dir = createTempDir();
    readMacOsKeychainSecretMock.mockResolvedValue(null);
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt: 1893456000000 } }),
      'utf8'
    );

    await expect(getClaudeCodeAuthStatus(dir)).resolves.toEqual({
      expiresAt: null,
      message: `Claude Code credentials file at ${join(
        dir,
        '.credentials.json'
      )} has no claudeAiOauth accessToken`,
      ok: false,
    });
  });

  it('reports invalid file credentials JSON', async () => {
    const dir = createTempDir();
    readMacOsKeychainSecretMock.mockResolvedValue(null);
    writeFileSync(join(dir, '.credentials.json'), '{not json', 'utf8');

    const status = await getClaudeCodeAuthStatus(dir);

    expect(status.ok).toBe(false);
    expect(status.expiresAt).toBeNull();
    expect(status.message).toEqual(expect.any(String));
  });
});
