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

const pickCanonicalRef = (
  value: Record<string, unknown>
): string | undefined => {
  if (typeof value.canonicalRef === 'string') return value.canonicalRef;
  if (typeof value.providerModel === 'string') return value.providerModel;
  return undefined;
};

const normalizeModelValue = (value: unknown) => {
  if (typeof value === 'string') {
    return toCanonicalModelBinding(value) ?? value;
  }

  if (!isRecord(value)) {
    return value;
  }

  const canonicalRef = pickCanonicalRef(value);
  if (!canonicalRef) return value;

  return toCanonicalModelBinding(canonicalRef) ?? value;
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
  if (typeof providerValue.type === 'string') {
    return providerValue.type === 'codex';
  }

  return (
    providerId === 'codex' ||
    'binary' in providerValue ||
    'codexHomeSource' in providerValue
  );
};

const firstString = (...candidates: unknown[]): string | undefined => {
  return candidates.find((c): c is string => typeof c === 'string');
};

const normalizeProviderValue = (
  providerValue: Record<string, unknown>
): ProviderConfig => {
  const { codexHomeSource, homePath, ...providerRest } = providerValue;

  return {
    ...providerRest,
    homePath: firstString(homePath, codexHomeSource),
    type: firstString(providerRest.type, 'codex'),
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

const haveMatchingType = (a: unknown, b: unknown): boolean => {
  return (
    isRecord(a) &&
    isRecord(b) &&
    'type' in a &&
    'type' in b &&
    a.type === b.type
  );
};

const mergeProviders = (
  base: AppConfig['providers'],
  overrides: Partial<AppConfig>['providers']
): AppConfig['providers'] => {
  const merged: AppConfig['providers'] = { ...base };

  for (const [providerId, providerConfig] of Object.entries(overrides ?? {})) {
    const baseProvider = base[providerId];

    if (haveMatchingType(baseProvider, providerConfig)) {
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
