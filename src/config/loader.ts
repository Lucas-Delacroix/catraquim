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

const configPaths = () => {
  const explicit = explicitConfigPath();
  return explicit
    ? [explicit]
    : [homeConfigPath(), localConfigPath()].filter((path, index, paths) => {
        return paths.indexOf(path) === index;
      });
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

export const loadConfig = (): AppConfig => {
  const merged = mergeConfig(defaultConfig, readUserConfig());
  const codexProvider = findFirstProviderByType(merged.providers, 'codex');

  const envAdjusted = mergeConfig(merged, {
    providers: codexProvider
      ? {
          [codexProvider.id]: {
            ...codexProvider.config,
            binary:
              readOptionalEnv('CATRAQUIM_CODEX_BINARY') ??
              codexProvider.config.binary,
            homePath: expandHome(codexProvider.config.homePath),
          },
        }
      : undefined,
    server: {
      host: merged.server.host,
      port: Number(readOptionalEnv('CATRAQUIM_PORT') ?? merged.server.port),
      token: readOptionalEnv('CATRAQUIM_TOKEN') ?? merged.server.token,
    },
  });

  return appConfigSchema.parse(envAdjusted);
};

export const resolvedConfigPaths = () => configPaths().filter(existsSync);
export { homeConfigPath, localConfigPath };
