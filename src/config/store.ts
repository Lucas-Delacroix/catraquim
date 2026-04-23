import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { modelKey, parseModelRef } from '../application/model-ref.js';
import { AppError } from '../errors.js';
import { defaultConfig } from './defaults.js';
import {
  type AppConfig,
  type ProviderConfig,
  appConfigSchema,
} from './schema.js';

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
  const {
    codex: legacyCodex,
    models: rawModels,
    providers: rawProviders,
    ...rest
  } = raw;
  const providers = isRecord(rawProviders) ? { ...rawProviders } : {};
  const models = isRecord(rawModels) ? { ...rawModels } : {};

  for (const [alias, modelValue] of Object.entries(models)) {
    if (typeof modelValue === 'string') {
      const parsed = parseModelRef(modelValue);
      if (parsed) {
        models[alias] = {
          adapter: parsed.providerId,
          upstreamModel: parsed.model,
        };
      }
      continue;
    }

    if (!isRecord(modelValue)) {
      continue;
    }

    const canonicalRef =
      typeof modelValue.canonicalRef === 'string'
        ? modelValue.canonicalRef
        : typeof modelValue.providerModel === 'string'
          ? modelValue.providerModel
          : undefined;

    if (!canonicalRef) {
      continue;
    }

    const parsed = parseModelRef(canonicalRef);
    if (parsed) {
      models[alias] = {
        adapter: parsed.providerId,
        upstreamModel: parsed.model,
      };
    }
  }

  if (!('codex' in providers) && isRecord(legacyCodex)) {
    providers.codex = legacyCodex;
  }

  for (const [providerId, providerValue] of Object.entries(providers)) {
    if (!isRecord(providerValue)) {
      continue;
    }

    if (
      providerId === 'codex' ||
      providerValue.type === 'codex' ||
      'binary' in providerValue ||
      'codexHomeSource' in providerValue
    ) {
      const { codexHomeSource, homePath, type, ...providerRest } =
        providerValue;

      providers[providerId] = {
        ...providerRest,
        homePath:
          typeof homePath === 'string'
            ? homePath
            : typeof codexHomeSource === 'string'
              ? codexHomeSource
              : undefined,
        type: type === 'codex' ? type : 'codex',
      };
    }
  }

  return {
    ...rest,
    models,
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

const mergeProviders = (
  base: AppConfig['providers'],
  overrides: Partial<AppConfig>['providers']
): AppConfig['providers'] => {
  const merged: AppConfig['providers'] = { ...base };

  for (const [providerId, providerConfig] of Object.entries(overrides ?? {})) {
    const baseProvider = base[providerId];

    if (
      isRecord(baseProvider) &&
      isRecord(providerConfig) &&
      'type' in baseProvider &&
      'type' in providerConfig &&
      baseProvider.type === providerConfig.type
    ) {
      merged[providerId] = {
        ...(baseProvider as ProviderConfig),
        ...(providerConfig as ProviderConfig),
      };
      continue;
    }

    if (providerConfig) {
      merged[providerId] = providerConfig as ProviderConfig;
    }
  }

  return merged;
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
    providers: mergeProviders(base.providers, overrides.providers),
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
  `${JSON.stringify(
    {
      ...config,
      models: Object.fromEntries(
        Object.entries(config.models).map(([alias, definition]) => [
          alias,
          modelKey(definition.adapter, definition.upstreamModel),
        ])
      ),
    },
    null,
    2
  )}\n`;

export const writeConfigFile = (filePath: string, config: AppConfig) => {
  ensureConfigDirectory(filePath);
  writeFileSync(filePath, serializeConfig(config), 'utf8');
};
