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

const usage = `catraquim <command>

Commands:
  start         Start the local HTTP gateway
  auth:status   Print auth status for configured adapters
  config:init   Create ~/.config/catraquim/config.json
  config:setup  Open an interactive config wizard
  config:path   Print the config file path
  config:validate
                Validate the config file against the schema
  config:edit   Open the config file in $EDITOR
`;

const printUsage = () => {
  process.stdout.write(usage);
};

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
    const statuses = await Promise.all(
      context.adapters.map(async (adapter) => {
        const { id: _id, ...status } = await adapter.status();
        return [adapter.id, status] as const;
      })
    );

    return Object.fromEntries(statuses);
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
      process.stdout.write(`${verb} config file at ${result.filePath}\n`);
      return;
    }
    case 'config:path': {
      ensureNoArgs(command, args);
      process.stdout.write(`${getConfigPath()}\n`);
      return;
    }
    case 'config:setup': {
      ensureNoArgs(command, args);
      const result = await setupConfig();
      if (result.cancelled) {
        process.stdout.write('Config setup cancelled\n');
        return;
      }

      const verb = result.created ? 'Created' : 'Updated';
      process.stdout.write(`${verb} config file at ${result.filePath}\n`);
      return;
    }
    case 'config:validate': {
      ensureNoArgs(command, args);
      const result = validateConfig();
      process.stdout.write(`Config is valid: ${result.filePath}\n`);
      return;
    }
    case 'config:edit': {
      ensureNoArgs(command, args);
      const result = editConfig();
      if (result.created) {
        process.stdout.write(`Created config file at ${result.filePath}\n`);
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
