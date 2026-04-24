import { describe, expect, it, vi } from 'vitest';

import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ResolvedChatRequest,
} from '../../src/adapters/base.js';
import { GetProviderStatusesUseCase } from '../../src/usecases/get-provider-statuses.js';

const createAdapter = (
  id: string,
  status: AdapterStatus
): Adapter & { status: ReturnType<typeof vi.fn> } => ({
  id,
  async *chat(
    _req: ResolvedChatRequest,
    _signal: AbortSignal
  ): AsyncIterable<ChatChunk> {},
  status: vi.fn().mockResolvedValue(status),
});

describe('GetProviderStatusesUseCase', () => {
  it('keys statuses by adapter id and strips the nested id field', async () => {
    const codex = createAdapter('codex', {
      expiresAt: '2026-05-01T00:00:00Z',
      id: 'nested-codex',
      ok: true,
    });
    const other = createAdapter('other', {
      id: 'nested-other',
      message: 'not configured',
      ok: false,
    });

    await expect(
      new GetProviderStatusesUseCase([codex, other]).execute()
    ).resolves.toEqual({
      codex: {
        expiresAt: '2026-05-01T00:00:00Z',
        ok: true,
      },
      other: {
        message: 'not configured',
        ok: false,
      },
    });

    expect(codex.status).toHaveBeenCalledTimes(1);
    expect(other.status).toHaveBeenCalledTimes(1);
  });

  it('returns an empty status map when no adapters are configured', async () => {
    await expect(new GetProviderStatusesUseCase([]).execute()).resolves.toEqual(
      {}
    );
  });
});
