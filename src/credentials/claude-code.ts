import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expandHome } from '../config/path-utils.js';
import { messageFromUnknownError } from '../errors.js';
import { readMacOsKeychainSecret } from './keychain.js';

export interface ClaudeCodeAuthStatus {
  expiresAt: string | null;
  message?: string;
  ok: boolean;
}

const CLAUDE_CODE_KEYCHAIN_SERVICE = 'Claude Code-credentials';

const resolveClaudeHome = (source?: string) =>
  expandHome(source ?? '~/.claude');

const parseExpiresAt = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric).toISOString();
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  return null;
};

const readClaudeOauth = (raw: string): Record<string, unknown> | null => {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const oauth = parsed.claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) {
    return null;
  }

  const record = oauth as Record<string, unknown>;
  return typeof record.accessToken === 'string' && record.accessToken
    ? record
    : null;
};

const statusFromOauth = (
  oauth: Record<string, unknown>
): ClaudeCodeAuthStatus => ({
  expiresAt: parseExpiresAt(oauth.expiresAt),
  ok: true,
});

const readKeychainOauth = async (): Promise<Record<string, unknown> | null> => {
  const keychainSecret = await readMacOsKeychainSecret(
    CLAUDE_CODE_KEYCHAIN_SERVICE
  );

  if (!keychainSecret) {
    return null;
  }

  try {
    return readClaudeOauth(keychainSecret);
  } catch {
    return null;
  }
};

const readCredentialsFileStatus = (authFile: string): ClaudeCodeAuthStatus => {
  if (!existsSync(authFile)) {
    return {
      expiresAt: null,
      message: `Missing Claude Code credentials file at ${authFile}`,
      ok: false,
    };
  }

  try {
    const oauth = readClaudeOauth(readFileSync(authFile, 'utf8'));
    if (!oauth) {
      return {
        expiresAt: null,
        message: `Claude Code credentials file at ${authFile} has no claudeAiOauth accessToken`,
        ok: false,
      };
    }

    return statusFromOauth(oauth);
  } catch (error) {
    return {
      expiresAt: null,
      message: messageFromUnknownError(
        error,
        'Failed to parse Claude Code credentials file'
      ),
      ok: false,
    };
  }
};

export const getClaudeCodeAuthStatus = async (
  source?: string
): Promise<ClaudeCodeAuthStatus> => {
  const keychainOauth = await readKeychainOauth();
  if (keychainOauth) {
    return statusFromOauth(keychainOauth);
  }

  const authFile = join(resolveClaudeHome(source), '.credentials.json');
  return readCredentialsFileStatus(authFile);
};
