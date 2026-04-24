import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { CodexAppServerClient } from './app-server.js';

const DISCOVERY_TIMEOUT_MS = 5_000;

const RPC_METHODS = ['listModels', 'model/list', 'models/list'] as const;

interface ModelEntry {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  model?: unknown;
}

const isModelEntry = (value: unknown): value is ModelEntry =>
  typeof value === 'object' && value !== null;

const extractModelId = (entry: ModelEntry): string | null => {
  for (const candidate of [entry.id, entry.slug, entry.name, entry.model]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const extractEntries = (result: unknown): ModelEntry[] => {
  if (Array.isArray(result)) {
    return result.filter(isModelEntry);
  }

  if (typeof result !== 'object' || result === null) {
    return [];
  }

  const record = result as Record<string, unknown>;
  for (const key of ['models', 'data', 'items']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(isModelEntry);
    }
  }

  return [];
};

const isMethodNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('method not found') ||
    message.includes('unknown method') ||
    message.includes('unsupported method')
  );
};

export const listCodexModels = async (
  client: CodexAppServerClient,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string[]> => {
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const attemptErrors: Error[] = [];

  for (const method of RPC_METHODS) {
    try {
      const result = await client.request(method, undefined, {
        signal: options.signal,
        timeoutMs,
      });

      const ids = extractEntries(result)
        .map(extractModelId)
        .filter((id): id is string => id !== null);

      if (ids.length === 0) {
        throw AppError.provider(
          `Codex ${method} returned no entries`,
          502,
          undefined,
          { code: 'list_models_empty' }
        );
      }

      logger.debug({ count: ids.length, method }, 'codex list-models resolved');
      return ids;
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error instanceof AppError
          ? error
          : AppError.provider(
              error instanceof Error
                ? error.message
                : 'Codex list-models failed',
              502,
              error,
              { code: 'list_models_failed' }
            );
      }
      if (error instanceof Error) attemptErrors.push(error);
    }
  }

  throw AppError.provider(
    'Codex app-server does not support model discovery',
    502,
    attemptErrors.at(-1),
    { code: 'list_models_unsupported' }
  );
};
