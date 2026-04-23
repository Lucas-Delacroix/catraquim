#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { run } from './cli/commands.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export { run } from './cli/commands.js';

const handleCliError = (error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  logger.error({ err: error }, 'CLI command failed');
  process.exitCode = 1;
};

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (import.meta.url === entrypoint) {
  run().catch(handleCliError);
}
