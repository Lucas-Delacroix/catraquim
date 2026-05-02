import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';

import { defaultConfig } from './defaults.js';
import { findFirstProviderByType } from './providers.js';
import { type AppConfig, appConfigSchema } from './schema.js';
import { expandHome, mergeConfig, readConfigFile } from './store.js';

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

const applyEnvOverrides = (config: AppConfig): AppConfig => {
  const claudeCodeProvider = findFirstProviderByType(
    config.providers,
    'claude-code'
  );
  const codexProvider = findFirstProviderByType(config.providers, 'codex');
  const providers: AppConfig['providers'] = {};

  if (claudeCodeProvider) {
    providers[claudeCodeProvider.id] = {
      ...claudeCodeProvider.config,
      binary:
        readOptionalEnv('CATRAQUIM_CLAUDE_CODE_BINARY') ??
        readOptionalEnv('CATRAQUIM_CLAUDE_BINARY') ??
        claudeCodeProvider.config.binary,
      homePath: expandHome(claudeCodeProvider.config.homePath),
    };
  }

  if (codexProvider) {
    providers[codexProvider.id] = {
      ...codexProvider.config,
      binary:
        readOptionalEnv('CATRAQUIM_CODEX_BINARY') ??
        codexProvider.config.binary,
      homePath: expandHome(codexProvider.config.homePath),
    };
  }

  return mergeConfig(config, {
    providers,
    server: {
      port: Number(readOptionalEnv('CATRAQUIM_PORT') ?? config.server.port),
      token: readOptionalEnv('CATRAQUIM_TOKEN') ?? config.server.token,
    },
  });
};

export const loadConfig = (): AppConfig => {
  const filePaths = listConfigPaths();
  const fileConfigs = readExistingConfigFiles(filePaths);
  const mergedConfig = mergeUserConfigs(fileConfigs);
  return appConfigSchema.parse(applyEnvOverrides(mergedConfig));
};

export const resolvedConfigPaths = () => listConfigPaths().filter(existsSync);
export { homeConfigPath, localConfigPath };
