import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import type { CodexAppServerClient } from './app-server.js';

const DISCOVERY_TIMEOUT_MS = 5_000;
const RPC_METHOD = 'model/list';
const MAX_PAGES = 20;

interface ListCodexModelsOptions {
  includeHidden?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface RawModelEntry {
  id?: unknown;
  model?: unknown;
  hidden?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractModelId = (entry: RawModelEntry): string | null =>
  readNonEmptyString(entry.id) ?? readNonEmptyString(entry.model);

interface Page {
  ids: string[];
  nextCursor: string | null;
}

const readPage = (result: unknown, includeHidden: boolean): Page => {
  if (!isObject(result) || !Array.isArray(result.data)) {
    return { ids: [], nextCursor: null };
  }

  const ids: string[] = [];
  for (const rawEntry of result.data) {
    if (!isObject(rawEntry)) continue;
    if (!includeHidden && rawEntry.hidden === true) continue;

    const id = extractModelId(rawEntry as RawModelEntry);
    if (id) ids.push(id);
  }

  const nextCursor = readNonEmptyString(result.nextCursor);
  return { ids, nextCursor };
};

export const listCodexModels = async (
  client: CodexAppServerClient,
  options: ListCodexModelsOptions = {}
): Promise<string[]> => {
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const includeHidden = options.includeHidden ?? false;
  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.request(
      RPC_METHOD,
      {
        cursor,
        includeHidden,
        limit: null,
      },
      {
        signal: options.signal,
        timeoutMs,
      }
    );

    const current = readPage(result, includeHidden);

    for (const id of current.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    if (!current.nextCursor) break;
    cursor = current.nextCursor;
  }

  if (ids.length === 0) {
    throw AppError.provider(
      `Codex ${RPC_METHOD} returned no entries`,
      502,
      undefined,
      { code: 'list_models_empty' }
    );
  }

  logger.debug({ count: ids.length }, 'codex list-models resolved');
  return ids;
};
