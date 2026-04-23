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

const toCanonicalModelBinding = (canonicalRef: string) => {
  const parsed = parseModelRef(canonicalRef);
  if (!parsed) {
    return undefined;
  }

  return {
    adapter: parsed.providerId,
    upstreamModel: parsed.model,
  };
};

const normalizeModelValue = (value: unknown) => {
  if (typeof value === 'string') {
    return toCanonicalModelBinding(value) ?? value;
  }

  if (!isRecord(value)) {
    return value;
  }

  const canonicalRef =
    typeof value.canonicalRef === 'string'
      ? value.canonicalRef
      : typeof value.providerModel === 'string'
        ? value.providerModel
        : undefined;

  return canonicalRef
    ? (toCanonicalModelBinding(canonicalRef) ?? value)
    : value;
};

const normalizeModels = (rawModels: unknown) => {
  if (!isRecord(rawModels)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawModels).map(([alias, modelValue]) => [
      alias,
      normalizeModelValue(modelValue),
    ])
  );
};

const looksLikeLegacyCodexProvider = (
  providerId: string,
  providerValue: Record<string, unknown>
) => {
  return (
    providerId === 'codex' ||
    providerValue.type === 'codex' ||
    'binary' in providerValue ||
    'codexHomeSource' in providerValue
  );
};

const normalizeProviderValue = (
  providerValue: Record<string, unknown>
): ProviderConfig => {
  const { codexHomeSource, homePath, type, ...providerRest } = providerValue;

  return {
    ...providerRest,
    homePath:
      typeof homePath === 'string'
        ? homePath
        : typeof codexHomeSource === 'string'
          ? codexHomeSource
          : undefined,
    type: type === 'codex' ? type : 'codex',
  } as ProviderConfig;
};

const normalizeProviders = (
  rawProviders: unknown,
  legacyCodex: unknown
): Record<string, ProviderConfig | unknown> => {
  const providers = isRecord(rawProviders) ? { ...rawProviders } : {};

  if (!('codex' in providers) && isRecord(legacyCodex)) {
    providers.codex = legacyCodex;
  }

  return Object.fromEntries(
    Object.entries(providers).map(([providerId, providerValue]) => {
      if (!isRecord(providerValue)) {
        return [providerId, providerValue];
      }

      return [
        providerId,
        looksLikeLegacyCodexProvider(providerId, providerValue)
          ? normalizeProviderValue(providerValue)
          : providerValue,
      ];
    })
  );
};

const serializeModels = (models: AppConfig['models']) => {
  return Object.fromEntries(
    Object.entries(models).map(([alias, definition]) => [
      alias,
      modelKey(definition.adapter, definition.upstreamModel),
    ])
  );
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

  return {
    ...rest,
    models: normalizeModels(rawModels),
    providers: normalizeProviders(rawProviders, legacyCodex),
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
      models: serializeModels(config.models),
    },
    null,
    2
  )}\n`;

export const writeConfigFile = (filePath: string, config: AppConfig) => {
  ensureConfigDirectory(filePath);
  writeFileSync(filePath, serializeConfig(config), 'utf8');
};
