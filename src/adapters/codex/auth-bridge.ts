import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const gatewayCodexHome = () =>
  join(homedir(), '.local', 'share', 'catraquim', 'codex-home');

export const prepareCodexHome = () => {
  const target = gatewayCodexHome();
  mkdirSync(target, { recursive: true });
  return target;
};
