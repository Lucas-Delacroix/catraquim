import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ResolvedChatRequest,
} from '../../src/adapters/base.js';
import { logger } from '../../src/logger.js';
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it('marks one provider as unhealthy when its status check fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const healthy = createAdapter('healthy', {
      id: 'healthy',
      ok: true,
    });
    const failing = createAdapter('failing', {
      id: 'failing',
      ok: true,
    });
    failing.status.mockRejectedValue(new Error('credential file unreadable'));

    await expect(
      new GetProviderStatusesUseCase([healthy, failing]).execute()
    ).resolves.toEqual({
      failing: {
        message: 'credential file unreadable',
        ok: false,
      },
      healthy: {
        ok: true,
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'failing',
      }),
      'Provider status check failed'
    );
  });
});
