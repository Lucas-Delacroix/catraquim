import { describe, expect, it, vi } from 'vitest';

import type { CodexAppServerClient } from '../../src/adapters/codex/app-server.js';
import { listCodexModels } from '../../src/adapters/codex/list-models.js';
import { AppError } from '../../src/errors.js';

interface MockRequest {
  method: string;
  params: unknown;
}

const makeClient = (
  impl: (method: string, params?: unknown) => Promise<unknown>
): { client: CodexAppServerClient; calls: MockRequest[] } => {
  const calls: MockRequest[] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return impl(method, params);
  });
  return {
    client: { request } as unknown as CodexAppServerClient,
    calls,
  };
};

describe('listCodexModels (model/list)', () => {
  it('sends model/list with limit/cursor/includeHidden params', async () => {
    const { client, calls } = makeClient(async () => ({
      data: [{ id: 'gpt-5.4', model: 'gpt-5.4', inputModalities: ['text'] }],
      nextCursor: null,
    }));

    await expect(listCodexModels(client)).resolves.toEqual(['gpt-5.4']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: 'model/list',
      params: { cursor: null, includeHidden: false, limit: null },
    });
  });

  it('extracts ids from the data array and prefers id over model field', async () => {
    const { client } = makeClient(async () => ({
      data: [
        { id: 'gpt-5.4', model: 'gpt-5.4' },
        { id: 'codex-max', model: 'codex-max' },
        { id: 'gpt-5.4-mini', model: 'gpt-5.4-mini' },
      ],
      nextCursor: null,
    }));

    await expect(listCodexModels(client)).resolves.toEqual([
      'gpt-5.4',
      'codex-max',
      'gpt-5.4-mini',
    ]);
  });

  it('skips hidden entries unless includeHidden is true', async () => {
    const { client, calls } = makeClient(async (_method, params) => {
      const includeHidden = (params as { includeHidden?: boolean })
        .includeHidden;
      return {
        data: [
          { id: 'public', model: 'public' },
          { id: 'secret', model: 'secret', hidden: true },
        ],
        nextCursor: null,
      };
    });

    await expect(listCodexModels(client)).resolves.toEqual(['public']);
    expect((calls[0]?.params as { includeHidden: boolean }).includeHidden).toBe(
      false
    );

    const hiddenRun = await listCodexModels(client, { includeHidden: true });
    expect(hiddenRun).toEqual(['public', 'secret']);
  });

  it('follows nextCursor to fetch additional pages and dedupes ids', async () => {
    let page = 0;
    const { client, calls } = makeClient(async () => {
      page++;
      if (page === 1) {
        return {
          data: [
            { id: 'a', model: 'a' },
            { id: 'b', model: 'b' },
          ],
          nextCursor: 'cursor-1',
        };
      }
      if (page === 2) {
        return {
          data: [
            { id: 'b', model: 'b' },
            { id: 'c', model: 'c' },
          ],
          nextCursor: null,
        };
      }
      throw new Error('unexpected extra page');
    });

    await expect(listCodexModels(client)).resolves.toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(2);
    expect((calls[1]?.params as { cursor: string }).cursor).toBe('cursor-1');
  });

  it('throws list_models_empty when data is empty on first page', async () => {
    const { client } = makeClient(async () => ({ data: [], nextCursor: null }));

    await expect(listCodexModels(client)).rejects.toMatchObject({
      code: 'list_models_empty',
      type: 'provider_error',
    });
  });

  it('throws list_models_empty when response has no data field', async () => {
    const { client } = makeClient(async () => ({ unrelated: true }));

    await expect(listCodexModels(client)).rejects.toMatchObject({
      code: 'list_models_empty',
    });
  });

  it('propagates RPC errors from the client', async () => {
    const { client } = makeClient(async () => {
      throw new Error('connection reset');
    });

    await expect(listCodexModels(client)).rejects.toThrow('connection reset');
  });

  it('wraps AppError propagation as-is', async () => {
    const { client } = makeClient(async () => {
      throw AppError.transient('boom', 504, undefined, { code: 'timeout' });
    });

    await expect(listCodexModels(client)).rejects.toBeInstanceOf(AppError);
  });
});
