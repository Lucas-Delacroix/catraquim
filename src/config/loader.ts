import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';

import { AppError } from '../errors.js';
import { defaultConfig } from './defaults.js';
import { type AppConfig, appConfigSchema } from './schema.js';

const expandHome = (value: string) => {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
};

const configPath = () => join(homedir(), '.config', 'catraquim', 'config.json');

const readUserConfig = (): Partial<AppConfig> => {
  const filePath = configPath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Partial<AppConfig>;
  } catch (error) {
    throw new AppError(`Failed to load config file at ${filePath}`, 500, error);
  }
};

const mergeConfig = (
  base: AppConfig,
  overrides: Partial<AppConfig>
): AppConfig => {
  return {
    codex: {
      ...base.codex,
      ...overrides.codex,
    },
    models: {
      ...base.models,
      ...overrides.models,
    },
    server: {
      ...base.server,
      ...overrides.server,
    },
  };
};

export const loadConfig = (): AppConfig => {
  const merged = mergeConfig(defaultConfig, readUserConfig());

  const envAdjusted = mergeConfig(merged, {
    codex: {
      binary: process.env.CATRAQUIM_CODEX_BINARY ?? merged.codex.binary,
      codexHomeSource: expandHome(merged.codex.codexHomeSource),
    },
    server: {
      host: merged.server.host,
      port: Number(process.env.CATRAQUIM_PORT ?? merged.server.port),
      token: process.env.CATRAQUIM_TOKEN ?? merged.server.token,
    },
  });

  return appConfigSchema.parse(envAdjusted);
};

export { configPath };
