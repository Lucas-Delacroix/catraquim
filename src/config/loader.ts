import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';

import { defaultConfig } from './defaults.js';
import { expandHome } from './path-utils.js';
import { findFirstProviderByType } from './providers.js';
import { type AppConfig, appConfigSchema } from './schema.js';
import { mergeConfig, readConfigFile } from './store.js';

const readOptionalEnv = (name: string) => {
  const value = process.env[name];
  if (!value || value === 'undefined' || value === 'null') {
    return undefined;
  }

  return value;
};

const homeConfigPath = () =>
  join(homedir(), '.config', 'catraquim', 'config.json');

const localConfigPath = () => join(process.cwd(), 'config.json');

const explicitConfigPath = () => {
  const value = readOptionalEnv('CATRAQUIM_CONFIG');
  if (!value) {
    return null;
  }

  return expandHome(value);
};

const listConfigPaths = () => {
  const explicit = explicitConfigPath();
  return explicit
    ? [explicit]
    : [homeConfigPath(), localConfigPath()].filter((path, index, paths) => {
        return paths.indexOf(path) === index;
      });
};

const readExistingConfigFiles = (filePaths: string[]): Partial<AppConfig>[] => {
  return filePaths
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readConfigFile(filePath));
};

const mergeUserConfigs = (configs: Partial<AppConfig>[]): AppConfig => {
  return configs.reduce(
    (mergedConfig, config) => mergeConfig(mergedConfig, config),
    defaultConfig
  );
};

const firstEnvValue = (...names: string[]) => {
  for (const name of names) {
    const value = readOptionalEnv(name);
    if (value) return value;
  }
  return undefined;
};

const providerBinaryEnvVars: Record<string, string[]> = {
  'claude-code': ['CATRAQUIM_CLAUDE_CODE_BINARY', 'CATRAQUIM_CLAUDE_BINARY'],
  codex: ['CATRAQUIM_CODEX_BINARY'],
};

const buildProviderOverrides = (config: AppConfig): AppConfig['providers'] => {
  const overrides: AppConfig['providers'] = {};

  for (const [type, envVars] of Object.entries(providerBinaryEnvVars)) {
    const provider = findFirstProviderByType(
      config.providers,
      type as keyof typeof providerBinaryEnvVars
    );
    if (!provider) continue;

    overrides[provider.id] = {
      ...provider.config,
      binary: firstEnvValue(...envVars) ?? provider.config.binary,
      homePath: expandHome(provider.config.homePath),
    };
  }

  return overrides;
};

const applyEnvOverrides = (config: AppConfig): AppConfig =>
  mergeConfig(config, {
    providers: buildProviderOverrides(config),
    server: {
      port: Number(readOptionalEnv('CATRAQUIM_PORT') ?? config.server.port),
      token: readOptionalEnv('CATRAQUIM_TOKEN') ?? config.server.token,
    },
  });

export const loadConfig = (): AppConfig => {
  const filePaths = listConfigPaths();
  const fileConfigs = readExistingConfigFiles(filePaths);
  const mergedConfig = mergeUserConfigs(fileConfigs);
  return appConfigSchema.parse(applyEnvOverrides(mergedConfig));
};

export const resolvedConfigPaths = () => listConfigPaths().filter(existsSync);
export { homeConfigPath, localConfigPath };
