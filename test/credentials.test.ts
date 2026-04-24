import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import { getCodexAuthStatus } from '../src/credentials/codex.js';
import { readMacOsKeychainSecret } from '../src/credentials/keychain.js';

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'catraquim-credentials-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  execFileMock.mockReset();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('getCodexAuthStatus', () => {
  it('returns a missing-auth status when auth.json does not exist', async () => {
    const codexHome = createTempDir();

    await expect(getCodexAuthStatus(codexHome)).resolves.toEqual({
      expiresAt: null,
      message: `Missing auth file at ${join(codexHome, 'auth.json')}`,
      ok: false,
    });
  });

  it.each([
    ['camelCase', { expiresAt: '2026-05-01T00:00:00Z' }],
    ['snake_case', { expires_at: '2026-06-01T00:00:00Z' }],
    ['missing', {}],
  ])('parses %s expiration fields from auth.json', async (_name, auth) => {
    const codexHome = createTempDir();
    writeFileSync(join(codexHome, 'auth.json'), JSON.stringify(auth), 'utf8');

    await expect(getCodexAuthStatus(codexHome)).resolves.toEqual({
      expiresAt:
        'expiresAt' in auth
          ? auth.expiresAt
          : 'expires_at' in auth
            ? auth.expires_at
            : null,
      ok: true,
    });
  });

  it('returns a parse failure status when auth.json is invalid JSON', async () => {
    const codexHome = createTempDir();
    writeFileSync(join(codexHome, 'auth.json'), '{not json', 'utf8');

    const status = await getCodexAuthStatus(codexHome);

    expect(status.ok).toBe(false);
    expect(status.expiresAt).toBeNull();
    expect(status.message).toEqual(expect.any(String));
  });
});

describe('readMacOsKeychainSecret', () => {
  it('returns null on non-macOS platforms without invoking security', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    await expect(readMacOsKeychainSecret('svc', 'acct')).resolves.toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reads and trims a secret from the macOS keychain', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    execFileMock.mockImplementation((_command, _args, callback) => {
      callback(null, '  secret-token\n');
    });

    await expect(readMacOsKeychainSecret('svc', 'acct')).resolves.toBe(
      'secret-token'
    );
    expect(execFileMock).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', 'svc', '-a', 'acct', '-w'],
      expect.any(Function)
    );
  });

  it('returns null when the macOS keychain command fails or is empty', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    execFileMock
      .mockImplementationOnce((_command, _args, callback) => {
        callback(new Error('missing'), '');
      })
      .mockImplementationOnce((_command, _args, callback) => {
        callback(null, '  \n');
      });

    await expect(readMacOsKeychainSecret('svc', 'acct')).resolves.toBeNull();
    await expect(readMacOsKeychainSecret('svc', 'acct')).resolves.toBeNull();
  });
});
