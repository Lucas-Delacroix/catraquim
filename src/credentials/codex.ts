import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expandHome } from '../config/path-utils.js';
import { messageFromUnknownError } from '../errors.js';

export interface CodexAuthStatus {
  expiresAt: string | null;
  message?: string;
  ok: boolean;
}

const resolveCodexHome = (source?: string) => expandHome(source ?? '~/.codex');

export const getCodexAuthStatus = async (
  source?: string
): Promise<CodexAuthStatus> => {
  const authFile = join(resolveCodexHome(source), 'auth.json');

  if (!existsSync(authFile)) {
    return {
      expiresAt: null,
      message: `Missing auth file at ${authFile}`,
      ok: false,
    };
  }

  try {
    const raw = readFileSync(authFile, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const expiresAt =
      typeof data.expiresAt === 'string'
        ? data.expiresAt
        : typeof data.expires_at === 'string'
          ? data.expires_at
          : null;

    return {
      expiresAt,
      ok: true,
    };
  } catch (error) {
    return {
      expiresAt: null,
      message: messageFromUnknownError(
        error,
        'Failed to parse Codex auth file'
      ),
      ok: false,
    };
  }
};
