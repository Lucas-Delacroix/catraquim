import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { AppError } from '../errors.js';
import { defaultConfig } from './defaults.js';
import { homeConfigPath } from './loader.js';
import { defaultCodexProvider, findFirstProviderByType } from './providers.js';
import {
  type AppConfig,
  type ProviderConfig,
  appConfigSchema,
} from './schema.js';
import { readEffectiveConfig, writeConfigFile } from './store.js';

const isQuoted = (value: string, quote: '"' | "'") =>
  value.startsWith(quote) && value.endsWith(quote);

const stripQuotes = (part: string): string => {
  if (isQuoted(part, '"') || isQuoted(part, "'")) {
    return part.slice(1, -1);
  }
  return part;
};

const splitCommand = (command: string): string[] => {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map(stripQuotes);
};

export interface InitConfigOptions {
  filePath?: string;
  force?: boolean;
}

export const initConfig = ({
  filePath = homeConfigPath(),
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

export const getConfigPath = () => homeConfigPath();

export const validateConfig = (filePath = homeConfigPath()) => {
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
  filePath = homeConfigPath(),
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

const AFFIRMATIVE_ANSWERS = new Set(['y', 'yes', 's', 'sim']);
const NEGATIVE_ANSWERS = new Set(['n', 'no', 'nao', 'não']);

const parseConfirmation = (answer: string): boolean | null => {
  if (AFFIRMATIVE_ANSWERS.has(answer)) return true;
  if (NEGATIVE_ANSWERS.has(answer)) return false;
  return null;
};

const normalizeToken = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const parsePort = (value: string) => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AppError(`Invalid port "${value}"`, 400);
  }

  return port;
};

export const formatSetupExamples = () => `Config examples:

Codex:
  Provider type: codex
  Provider id: codex
  Codex binary: codex
  Codex home: ~/.codex
  Primary model alias: codex-max
  Primary canonical model: codex/gpt-5.4
  Second model alias: codex-mini
  Second canonical model: codex/gpt-5.4-mini

Claude Code:
  Provider type: claude-code
  Provider id: claude-code
  Claude Code binary: claude
  Claude Code home: ~/.claude
  Primary model alias: claude-opus
  Primary canonical model: claude-code/claude-opus-4-7
  Second model alias: claude-sonnet
  Second canonical model: claude-code/claude-sonnet-4-6

`;

const parseProviderType = (value: string): ProviderConfig['type'] => {
  const providerType = value.trim();

  if (providerType === 'codex' || providerType === 'claude-code') {
    return providerType;
  }

  if (providerType === 'claude') {
    return 'claude-code';
  }

  throw new AppError(`Invalid provider type "${value}"`, 400);
};

const providerPromptName = (providerType: ProviderConfig['type']) =>
  providerType === 'claude-code' ? 'Claude Code' : 'Codex';

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

type ModelEntry = [string, AppConfig['models'][string]];

const fallbackEntry = (alias: string): ModelEntry => {
  const model = defaultConfig.models[alias];
  if (!model) {
    throw new AppError(`Missing default model alias "${alias}"`, 500);
  }

  return [alias, model];
};

const fallbackModelAliases = (
  providerType: ProviderConfig['type']
): [string, string] =>
  providerType === 'claude-code'
    ? ['claude-opus', 'claude-sonnet']
    : ['codex-max', 'codex-mini'];

interface ModelDefaults {
  hasSecondary: boolean;
  primary: ModelEntry;
  secondary: ModelEntry;
}

const resolveDefaultModelEntries = (
  providerType: ProviderConfig['type']
): ModelDefaults => {
  const fallbackAliases = fallbackModelAliases(providerType);
  const candidates = fallbackAliases.map(fallbackEntry);

  return {
    hasSecondary: candidates.length > 1,
    primary: candidates[0] ?? fallbackEntry(fallbackAliases[0]),
    secondary: candidates[1] ?? fallbackEntry(fallbackAliases[1]),
  };
};

const defaultProviderForType = (providerType: ProviderConfig['type']) =>
  findFirstProviderByType(defaultConfig.providers, providerType) ??
  defaultCodexProvider();

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

      if (answer === '') return defaultValue;

      const parsed = parseConfirmation(answer);
      if (parsed === null) {
        throw new AppError(`Invalid confirmation "${answer}"`, 400);
      }
      return parsed;
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
  filePath = homeConfigPath(),
  input = process.stdin,
  output = process.stdout,
  promptApi,
}: SetupConfigOptions = {}) => {
  const currentConfig = readEffectiveConfig(filePath);
  const currentProvider =
    findFirstProviderByType(currentConfig.providers, 'codex') ??
    defaultCodexProvider();
  const prompts = promptApi ?? createPromptApi(input, output);
  const created = !existsSync(filePath);

  try {
    if (!promptApi) {
      output.write(formatSetupExamples());
    }

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
    const providerType = parseProviderType(
      await prompts.ask(
        'Provider type (codex|claude-code)',
        currentProvider.config.type
      )
    );
    const providerDefaults = defaultProviderForType(providerType);
    const providerId = await prompts.ask('Provider id', providerDefaults.id);
    const providerName = providerPromptName(providerType);
    const binary = await prompts.ask(
      `${providerName} binary`,
      providerDefaults.config.binary
    );
    const homePath = await prompts.ask(
      `${providerName} home`,
      providerDefaults.config.homePath
    );
    const {
      primary: firstModel,
      secondary: secondModel,
      hasSecondary,
    } = resolveDefaultModelEntries(providerType);
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
      hasSecondary
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
          type: providerType,
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
