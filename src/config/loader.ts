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

const homeConfigPath = () =>
  join(homedir(), '.config', 'catraquim', 'config.json');

const localConfigPath = () => join(process.cwd(), 'config.json');

const explicitConfigPath = () => {
  const value = process.env.CATRAQUIM_CONFIG;
  if (!value) {
    return null;
  }

  return expandHome(value);
};

const configPaths = () => {
  const explicit = explicitConfigPath();
  return explicit
    ? [explicit]
    : [homeConfigPath(), localConfigPath()].filter((path, index, paths) => {
        return paths.indexOf(path) === index;
      });
};

const readConfigFile = (filePath: string): Partial<AppConfig> => {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Partial<AppConfig>;
  } catch (error) {
    throw new AppError(`Failed to load config file at ${filePath}`, 500, error);
  }
};

const readUserConfig = (): Partial<AppConfig> => {
  let mergedConfig: Partial<AppConfig> = {};

  for (const filePath of configPaths()) {
    if (!existsSync(filePath)) {
      continue;
    }

    mergedConfig = mergeConfig(
      mergeConfig(defaultConfig, mergedConfig),
      readConfigFile(filePath)
    );
  }

  return mergedConfig;
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

export const resolvedConfigPaths = () => configPaths().filter(existsSync);
export { homeConfigPath, localConfigPath };
