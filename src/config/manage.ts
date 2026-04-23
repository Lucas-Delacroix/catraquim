import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { AppError } from '../errors.js';
import { defaultConfig } from './defaults.js';
import { homeConfigPath } from './loader.js';
import { defaultCodexProvider, findFirstProviderByType } from './providers.js';
import { type AppConfig, appConfigSchema } from './schema.js';
import { readEffectiveConfig, writeConfigFile } from './store.js';

const splitCommand = (command: string): string[] => {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
};

export interface InitConfigOptions {
  filePath?: string;
  force?: boolean;
}

const configPath = () => homeConfigPath();

export const initConfig = ({
  filePath = configPath(),
  force = false,
}: InitConfigOptions = {}) => {
  const alreadyExists = existsSync(filePath);
  if (alreadyExists && !force) {
    throw new AppError(
      `Config file already exists at ${filePath}. Use --force to overwrite.`,
      409
    );
  }

  writeConfigFile(filePath, defaultConfig);

  return {
    created: !alreadyExists,
    filePath,
  };
};

export const getConfigPath = () => configPath();

export const validateConfig = (filePath = configPath()) => {
  if (!existsSync(filePath)) {
    throw new AppError(`Config file not found at ${filePath}`, 404);
  }

  return {
    config: readEffectiveConfig(filePath),
    filePath,
  };
};

export interface EditConfigOptions {
  editor?: string;
  filePath?: string;
}

export const editConfig = ({
  editor = process.env.EDITOR,
  filePath = configPath(),
}: EditConfigOptions = {}) => {
  if (!editor) {
    throw new AppError('EDITOR is not set', 400);
  }

  let created = false;
  if (!existsSync(filePath)) {
    initConfig({ filePath });
    created = true;
  }

  const [command, ...args] = splitCommand(editor);
  if (!command) {
    throw new AppError('EDITOR is empty', 400);
  }

  const result = spawnSync(command, [...args, filePath], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw new AppError(
      `Failed to launch editor "${editor}"`,
      500,
      result.error
    );
  }

  if (result.signal) {
    throw new AppError(`Editor terminated with signal ${result.signal}`, 500);
  }

  if (result.status !== 0) {
    throw new AppError(`Editor exited with status ${result.status}`, 500);
  }

  return {
    created,
    filePath,
  };
};

export interface PromptApi {
  ask(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
  close(): void;
}

interface ModelPromptDefaults {
  alias: string;
  canonicalModel: string;
}

interface PromptedModel {
  alias: string;
  binding: {
    providerId: string;
    upstreamModel: string;
  };
}

const normalizeToken = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const parsePort = (value: string) => {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new AppError(`Invalid port "${value}"`, 400);
  }

  return port;
};

const parseCanonicalModelInput = (value: string, providerId: string) => {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new AppError('Model reference cannot be empty', 400);
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return {
      providerId,
      upstreamModel: trimmed,
    };
  }

  const parsedProviderId = trimmed.slice(0, slashIndex).trim();
  const upstreamModel = trimmed.slice(slashIndex + 1).trim();

  if (!parsedProviderId || !upstreamModel) {
    throw new AppError(`Invalid canonical model "${value}"`, 400);
  }

  if (parsedProviderId !== providerId) {
    throw new AppError(
      `Canonical model "${value}" must use provider "${providerId}"`,
      400
    );
  }

  return {
    providerId: parsedProviderId,
    upstreamModel,
  };
};

const promptModel = async (
  prompts: PromptApi,
  labels: {
    alias: string;
    canonicalModel: string;
  },
  defaults: ModelPromptDefaults,
  providerId: string
): Promise<PromptedModel> => {
  const alias = await prompts.ask(labels.alias, defaults.alias);
  const canonicalModel = await prompts.ask(
    labels.canonicalModel,
    defaults.canonicalModel
  );

  return {
    alias,
    binding: parseCanonicalModelInput(canonicalModel, providerId),
  };
};

const buildModelsConfig = (
  primary: PromptedModel,
  secondary?: PromptedModel
): AppConfig['models'] => {
  if (secondary && secondary.alias === primary.alias) {
    throw new AppError('Model aliases must be different', 400);
  }

  const models: AppConfig['models'] = {
    [primary.alias]: {
      adapter: primary.binding.providerId,
      upstreamModel: primary.binding.upstreamModel,
    },
  };

  if (!secondary) {
    return models;
  }

  models[secondary.alias] = {
    adapter: secondary.binding.providerId,
    upstreamModel: secondary.binding.upstreamModel,
  };

  return models;
};

const createPromptApi = (
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): PromptApi => {
  if (!input.isTTY || !output.isTTY) {
    throw new AppError('config:setup requires an interactive terminal', 400);
  }

  const rl = createInterface({
    input,
    output,
  });

  return {
    ask: async (prompt, defaultValue) => {
      const suffix =
        defaultValue === undefined || defaultValue === ''
          ? ''
          : ` [${defaultValue}]`;
      const answer = await rl.question(`${prompt}${suffix}: `);
      return answer.trim() === '' && defaultValue !== undefined
        ? defaultValue
        : answer.trim();
    },
    confirm: async (prompt, defaultValue = true) => {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
      const answer = (await rl.question(`${prompt}${suffix}: `))
        .trim()
        .toLowerCase();

      if (answer === '') {
        return defaultValue;
      }

      if (['y', 'yes', 's', 'sim'].includes(answer)) {
        return true;
      }

      if (['n', 'no', 'nao', 'não'].includes(answer)) {
        return false;
      }

      throw new AppError(`Invalid confirmation "${answer}"`, 400);
    },
    close: () => {
      rl.close();
    },
  };
};

export interface SetupConfigOptions {
  filePath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  promptApi?: PromptApi;
}

export const setupConfig = async ({
  filePath = configPath(),
  input = process.stdin,
  output = process.stdout,
  promptApi,
}: SetupConfigOptions = {}) => {
  const currentConfig = readEffectiveConfig(filePath);
  const currentProvider =
    findFirstProviderByType(currentConfig.providers, 'codex') ??
    defaultCodexProvider();
  const modelEntries = Object.entries(currentConfig.models);
  const firstModel = modelEntries[0] ?? [
    'codex-max',
    defaultConfig.models['codex-max'],
  ];
  const secondModel = modelEntries[1] ?? [
    'codex-mini',
    defaultConfig.models['codex-mini'],
  ];
  const prompts = promptApi ?? createPromptApi(input, output);
  const created = !existsSync(filePath);

  try {
    const host = await prompts.ask('Host', currentConfig.server.host);
    const port = parsePort(
      await prompts.ask('Port', String(currentConfig.server.port))
    );
    const token = normalizeToken(
      await prompts.ask(
        'Bearer token (blank = none)',
        currentConfig.server.token ?? ''
      )
    );
    const providerId = await prompts.ask('Provider id', currentProvider.id);
    const binary = await prompts.ask(
      'Codex binary',
      currentProvider.config.binary
    );
    const homePath = await prompts.ask(
      'Codex home',
      currentProvider.config.homePath
    );
    const primaryModel = await promptModel(
      prompts,
      {
        alias: 'Primary model alias',
        canonicalModel: 'Primary canonical model',
      },
      {
        alias: firstModel[0],
        canonicalModel: `${providerId}/${firstModel[1].upstreamModel}`,
      },
      providerId
    );
    const includeSecondModel = await prompts.confirm(
      'Configure a second model',
      modelEntries.length > 1
    );

    let secondModelInput: PromptedModel | undefined;
    if (includeSecondModel) {
      secondModelInput = await promptModel(
        prompts,
        {
          alias: 'Second model alias',
          canonicalModel: 'Second canonical model',
        },
        {
          alias: secondModel[0],
          canonicalModel: `${providerId}/${secondModel[1].upstreamModel}`,
        },
        providerId
      );
    }

    const models = buildModelsConfig(primaryModel, secondModelInput);

    const nextConfig = appConfigSchema.parse({
      models,
      providers: {
        [providerId]: {
          type: 'codex',
          binary,
          homePath,
        },
      },
      server: {
        host,
        port,
        token,
      },
    });

    const shouldWrite = await prompts.confirm(
      `Write config to ${filePath}`,
      true
    );

    if (!shouldWrite) {
      return {
        cancelled: true,
        created: false,
        filePath,
      };
    }

    writeConfigFile(filePath, nextConfig);

    return {
      cancelled: false,
      created,
      filePath,
    };
  } finally {
    prompts.close();
  }
};
