import { spawn } from 'node:child_process';

import type { ClaudeCodeProviderConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { ResolvedChatRequest, Usage } from '../base.js';
import { buildClaudeCodeEnv } from './env.js';
import { parseClaudeCodeOutput } from './output.js';
import { toClaudeCodeRunArgs } from './request-mapper.js';

export interface ClaudeCodeRunResult {
  text: string;
  usage?: Usage;
}

const binaryNotFoundError = (config: ClaudeCodeProviderConfig, error: Error) =>
  AppError.configuration(
    `Claude Code binary not found: ${config.binary}`,
    500,
    error,
    {
      code: 'binary_not_found',
      details: {
        binary: config.binary,
      },
    }
  );

const processError = (config: ClaudeCodeProviderConfig, error: Error) => {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? binaryNotFoundError(config, error)
    : AppError.transient('Claude Code process error', 502, error, {
        code: 'process_error',
      });
};

const exitError = (code: number | null, stderr: string) =>
  AppError.provider(
    stderr.trim() || `Claude Code exited with status ${code ?? 'null'}`,
    502,
    undefined,
    {
      code: 'process_exit',
      details: {
        code,
      },
    }
  );

const abortError = () =>
  AppError.transient('Claude Code run aborted', 499, undefined, {
    code: 'run_aborted',
  });

export const runClaudeCode = (
  config: ClaudeCodeProviderConfig,
  req: ResolvedChatRequest,
  signal: AbortSignal
): Promise<ClaudeCodeRunResult> => {
  const { args, prompt } = toClaudeCodeRunArgs(req);

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const child = spawn(config.binary, args, {
      cwd: process.cwd(),
      env: buildClaudeCodeEnv(config.homePath),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (next: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      next();
    };

    const handleAbort = () => {
      child.kill('SIGTERM');
      settle(() => reject(abortError()));
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      logger.debug({ chunk: text }, 'claude code stderr');
    });

    child.once('error', (error) => {
      settle(() => reject(processError(config, error)));
    });

    child.once('close', (code) => {
      if (code !== 0) {
        settle(() => reject(exitError(code, stderr)));
        return;
      }

      try {
        const parsed = parseClaudeCodeOutput(stdout);
        settle(() =>
          resolve({
            text: parsed.text,
            usage: parsed.usage,
          })
        );
      } catch (error) {
        settle(() =>
          reject(
            AppError.provider(
              'Failed to parse Claude Code output',
              502,
              error,
              {
                code: 'output_parse_failed',
              }
            )
          )
        );
      }
    });

    child.stdin?.end(`${prompt}\n`);
  });
};
