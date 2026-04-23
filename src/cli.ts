#!/usr/bin/env node
import { loadConfig } from './config/loader.js';
import { getCodexAuthStatus } from './credentials/codex.js';
import { logger } from './logger.js';
import { startServer } from './server.js';

const printUsage = () => {
  process.stdout.write(`catraquim <command>

Commands:
  start         Start the local HTTP gateway
  auth:status   Print current Codex auth status
`);
};

const run = async () => {
  const command = process.argv[2] ?? 'start';

  switch (command) {
    case 'start': {
      startServer();
      return;
    }
    case 'auth:status': {
      const config = loadConfig();
      const status = await getCodexAuthStatus(config.codex.codexHomeSource);
      process.stdout.write(`${JSON.stringify({ codex: status }, null, 2)}\n`);
      return;
    }
    case '--help':
    case '-h':
    case 'help': {
      printUsage();
      return;
    }
    default: {
      printUsage();
      process.exitCode = 1;
    }
  }
};

run().catch((error) => {
  logger.error({ err: error }, 'CLI command failed');
  process.exitCode = 1;
});
