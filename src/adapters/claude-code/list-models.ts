import { spawn } from 'node:child_process';

import type { ClaudeCodeProviderConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { buildClaudeCodeEnv } from './env.js';

const DISCOVERY_TIMEOUT_MS = 5_000;

interface ClaudeCodeListModelsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ModelEntry {
  id?: unknown;
  name?: unknown;
  model?: unknown;
}

const isModelEntry = (value: unknown): value is ModelEntry =>
  typeof value === 'object' && value !== null;

const extractModelId = (entry: ModelEntry): string | null => {
  for (const candidate of [entry.id, entry.name, entry.model]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const parseModelIds = (stdout: string): string[] => {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { models?: unknown })?.models)
        ? (parsed as { models: unknown[] }).models
        : Array.isArray((parsed as { data?: unknown })?.data)
          ? (parsed as { data: unknown[] }).data
          : [];

    const ids = entries
      .filter(isModelEntry)
      .map(extractModelId)
      .filter((id): id is string => id !== null);

    if (ids.length > 0) return ids;
  } catch {
    // Not JSON — try line-based parsing below.
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
};

export const listClaudeCodeModels = (
  config: ClaudeCodeProviderConfig,
  options: ClaudeCodeListModelsOptions = {}
): Promise<string[]> => {
  const signal = options.signal;
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        AppError.transient('Claude Code list-models aborted', 499, undefined, {
          code: 'list_models_aborted',
        })
      );
      return;
    }

    const child = spawn(
      config.binary,
      ['--list-models', '--output-format', 'json'],
      {
        cwd: process.cwd(),
        env: buildClaudeCodeEnv(config.homePath),
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    const settle = (next: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      signal?.removeEventListener('abort', handleAbort);
      next();
    };

    const handleAbort = () => {
      child.kill('SIGTERM');
      settle(() =>
        reject(
          AppError.transient(
            'Claude Code list-models aborted',
            499,
            undefined,
            { code: 'list_models_aborted' }
          )
        )
      );
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.once('error', (error) => {
      settle(() =>
        reject(
          AppError.provider(
            `Claude Code list-models failed: ${error.message}`,
            502,
            error,
            { code: 'list_models_failed' }
          )
        )
      );
    });

    child.once('close', (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            AppError.provider(
              stderr.trim() ||
                `Claude Code list-models exited with status ${code ?? 'null'}`,
              502,
              undefined,
              {
                code: 'list_models_exit',
                details: { exitCode: code },
              }
            )
          )
        );
        return;
      }

      try {
        const ids = parseModelIds(stdout);
        if (ids.length === 0) {
          settle(() =>
            reject(
              AppError.provider(
                'Claude Code list-models returned no entries',
                502,
                undefined,
                { code: 'list_models_empty' }
              )
            )
          );
          return;
        }
        logger.debug(
          { binary: config.binary, count: ids.length },
          'claude code list-models resolved'
        );
        settle(() => resolve(ids));
      } catch (error) {
        settle(() =>
          reject(
            AppError.provider(
              'Failed to parse Claude Code list-models output',
              502,
              error,
              { code: 'list_models_parse_failed' }
            )
          )
        );
      }
    });
  });
};
