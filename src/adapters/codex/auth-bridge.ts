import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { logger } from '../../logger.js';

export const gatewayCodexHome = () =>
  join(homedir(), '.local', 'share', 'catraquim', 'codex-home');

const resolveSource = (source: string): string => {
  if (source === '~') return homedir();
  if (source.startsWith('~/')) return join(homedir(), source.slice(2));
  return source;
};

export const prepareCodexHome = (sourceHomePath: string): string => {
  const target = gatewayCodexHome();
  mkdirSync(target, { recursive: true });

  const srcAuth = join(resolveSource(sourceHomePath), 'auth.json');
  const dstAuth = join(target, 'auth.json');

  if (existsSync(srcAuth)) {
    try {
      copyFileSync(srcAuth, dstAuth);
    } catch (error) {
      logger.warn({ error, srcAuth }, 'Failed to copy Codex auth.json');
    }
  } else {
    logger.warn({ srcAuth }, 'Codex auth.json not found at source');
  }

  return target;
};
