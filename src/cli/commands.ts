import { parseArgs } from 'node:util';

import {
  editConfig,
  getConfigPath,
  initConfig,
  setupConfig,
  validateConfig,
} from '../config/manage.js';
import { AppError } from '../errors.js';
import { createServerContext, startServer } from '../server.js';
import { printBanner } from './banner.js';
import { bold, cyan, dim, green } from './colors.js';

const usage = () =>
  [
    `${bold('catraquim')} ${dim('<command>')}`,
    '',
    bold('Commands:'),
    `  ${cyan('start')}            Start the local HTTP gateway`,
    `  ${cyan('auth:status')}      Print auth status for configured adapters`,
    `  ${cyan('config:init')}      Create ~/.config/catraquim/config.json`,
    `  ${cyan('config:setup')}     Open an interactive config wizard`,
    `  ${cyan('config:path')}      Print the config file path`,
    `  ${cyan('config:validate')}  Validate the config file against the schema`,
    `  ${cyan('config:edit')}      Open the config file in $EDITOR`,
    '',
  ].join('\n');

const printUsage = () => {
  printBanner();
  process.stdout.write(usage());
};

const ok = (msg: string) => process.stdout.write(`${green('✓')} ${msg}\n`);
const info = (msg: string) => process.stdout.write(`${dim('→')} ${msg}\n`);

const parseConfigInitArgs = (args: string[]) => {
  const parsed = parseArgs({
    allowPositionals: true,
    args,
    options: {
      force: {
        short: 'f',
        type: 'boolean',
      },
    },
    strict: true,
  });

  if (parsed.positionals.length > 0) {
    throw new AppError(
      `Unknown arguments for config:init: ${parsed.positionals.join(' ')}`,
      400
    );
  }

  return parsed.values;
};

const ensureNoArgs = (command: string, args: string[]) => {
  if (args.length === 0) return;
  throw new AppError(
    `Unknown arguments for ${command}: ${args.join(' ')}`,
    400
  );
};

const getAdapterStatuses = async () => {
  const context = createServerContext();

  try {
    return await context.getProviderStatuses.execute();
  } finally {
    for (const adapter of context.adapters) {
      adapter.shutdown?.();
    }
  }
};

export const run = async (argv = process.argv.slice(2)) => {
  const command = argv[0] ?? 'start';
  const args = argv.slice(1);

  switch (command) {
    case 'start': {
      ensureNoArgs(command, args);
      printBanner();
      startServer();
      return;
    }
    case 'auth:status': {
      ensureNoArgs(command, args);
      const status = await getAdapterStatuses();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case 'config:init': {
      const { force } = parseConfigInitArgs(args);
      const result = initConfig({ force });
      const verb = result.created ? 'Created' : 'Overwrote';
      ok(`${verb} config file at ${result.filePath}`);
      return;
    }
    case 'config:path': {
      ensureNoArgs(command, args);
      info(getConfigPath());
      return;
    }
    case 'config:setup': {
      ensureNoArgs(command, args);
      const result = await setupConfig();
      if (result.cancelled) {
        info('Config setup cancelled');
        return;
      }

      const verb = result.created ? 'Created' : 'Updated';
      ok(`${verb} config file at ${result.filePath}`);
      return;
    }
    case 'config:validate': {
      ensureNoArgs(command, args);
      const result = validateConfig();
      ok(`Config is valid: ${result.filePath}`);
      return;
    }
    case 'config:edit': {
      ensureNoArgs(command, args);
      const result = editConfig();
      if (result.created) {
        ok(`Created config file at ${result.filePath}`);
      }
      return;
    }
    case '--help':
    case '-h':
    case 'help': {
      ensureNoArgs(command, args);
      printUsage();
      return;
    }
    default: {
      printUsage();
      process.exitCode = 1;
    }
  }
};
