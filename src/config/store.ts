import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { AppError } from '../errors.js';
import { defaultConfig } from './defaults.js';
import { type AppConfig, appConfigSchema } from './schema.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const expandHome = (value: string) => {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
};

export const normalizeConfigShape = (raw: Record<string, unknown>) => {
  const { codex: legacyCodex, providers: rawProviders, ...rest } = raw;
  const providers = isRecord(rawProviders) ? { ...rawProviders } : {};

  if (!('codex' in providers) && isRecord(legacyCodex)) {
    providers.codex = legacyCodex;
  }

  if (isRecord(providers.codex)) {
    const { codexHomeSource, homePath, ...providerRest } = providers.codex;

    providers.codex = {
      ...providerRest,
      homePath:
        typeof homePath === 'string'
          ? homePath
          : typeof codexHomeSource === 'string'
            ? codexHomeSource
            : undefined,
    };
  }

  return {
    ...rest,
    providers,
  };
};

export const parseConfigJson = (
  raw: string,
  filePath: string
): Partial<AppConfig> => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeConfigShape(parsed) as Partial<AppConfig>;
  } catch (error) {
    throw new AppError(
      `Failed to parse config file at ${filePath}`,
      500,
      error
    );
  }
};

export const mergeConfig = (
  base: AppConfig,
  overrides: Partial<AppConfig>
): AppConfig => {
  return {
    models: {
      ...base.models,
      ...overrides.models,
    },
    providers: {
      ...base.providers,
      ...overrides.providers,
      codex: {
        ...base.providers.codex,
        ...overrides.providers?.codex,
      },
    },
    server: {
      ...base.server,
      ...overrides.server,
    },
  };
};

export const readConfigFile = (filePath: string): Partial<AppConfig> => {
  const raw = readFileSync(filePath, 'utf8');
  return parseConfigJson(raw, filePath);
};

export const readEffectiveConfig = (filePath: string) => {
  if (!existsSync(filePath)) {
    return defaultConfig;
  }

  return appConfigSchema.parse(
    mergeConfig(defaultConfig, readConfigFile(filePath))
  );
};

export const ensureConfigDirectory = (filePath: string) => {
  mkdirSync(dirname(filePath), { recursive: true });
};

export const serializeConfig = (config: AppConfig) =>
  `${JSON.stringify(config, null, 2)}\n`;

export const writeConfigFile = (filePath: string, config: AppConfig) => {
  ensureConfigDirectory(filePath);
  writeFileSync(filePath, serializeConfig(config), 'utf8');
};
