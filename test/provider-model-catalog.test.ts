import { describe, expect, it, vi } from 'vitest';

import type { Adapter } from '../src/adapters/base.js';
import { ProviderModelCatalog } from '../src/application/provider-model-catalog.js';
import type { AppConfig } from '../src/config/schema.js';

const providers: AppConfig['providers'] = {
  claude: {
    binary: 'claude',
    homePath: '~/.claude',
    type: 'claude-code',
  },
  codex: {
    binary: 'codex',
    homePath: '~/.codex',
    type: 'codex',
  },
};

const makeAdapter = (id: string, listModels?: Adapter['listModels']): Adapter =>
  ({
    id,
    chat: vi.fn(),
    status: vi.fn(),
    ...(listModels ? { listModels } : {}),
  }) as Adapter;

describe('ProviderModelCatalog (dynamic discovery)', () => {
  it('starts with static model ids as fallback', () => {
    const catalog = new ProviderModelCatalog(providers);

    expect(catalog.has('claude', 'opus')).toBe(true);
    expect(catalog.has('codex', 'codex-max')).toBe(true);
    expect(catalog.sourceFor('claude')).toBe('static');
    expect(catalog.sourceFor('codex')).toBe('static');
  });

  it('replaces provider entries with discovered ids after refresh', async () => {
    const catalog = new ProviderModelCatalog(providers);

    const claudeAdapter = makeAdapter('claude', async () => [
      'claude-opus-5-0',
      'claude-sonnet-5-0',
    ]);
    const codexAdapter = makeAdapter('codex', async () => [
      'gpt-6.0',
      'gpt-6.0-mini',
    ]);

    await catalog.refresh([claudeAdapter, codexAdapter]);

    expect(catalog.has('claude', 'claude-opus-5-0')).toBe(true);
    expect(catalog.has('claude', 'opus')).toBe(false);
    expect(catalog.has('codex', 'gpt-6.0')).toBe(true);
    expect(catalog.has('codex', 'codex-max')).toBe(false);
    expect(catalog.sourceFor('claude')).toBe('dynamic');
    expect(catalog.sourceFor('codex')).toBe('dynamic');
  });

  it('keeps static entries when discovery rejects', async () => {
    const catalog = new ProviderModelCatalog(providers);

    const claudeAdapter = makeAdapter('claude', async () => {
      throw new Error('list_models_unsupported');
    });

    await catalog.refresh([claudeAdapter]);

    expect(catalog.has('claude', 'opus')).toBe(true);
    expect(catalog.sourceFor('claude')).toBe('static');
  });

  it('keeps static entries when discovery returns empty list', async () => {
    const catalog = new ProviderModelCatalog(providers);

    const adapter = makeAdapter('claude', async () => []);
    await catalog.refresh([adapter]);

    expect(catalog.has('claude', 'opus')).toBe(true);
    expect(catalog.sourceFor('claude')).toBe('static');
  });

  it('ignores adapters without listModels', async () => {
    const catalog = new ProviderModelCatalog(providers);
    const adapter = makeAdapter('claude');

    await catalog.refresh([adapter]);

    expect(catalog.sourceFor('claude')).toBe('static');
  });

  it('ignores adapters not registered in providers config', async () => {
    const catalog = new ProviderModelCatalog(providers);
    const adapter = makeAdapter('unknown', async () => ['foo']);

    await catalog.refresh([adapter]);

    expect(catalog.has('unknown', 'foo')).toBe(false);
  });

  it('reports staleness based on TTL', async () => {
    const catalog = new ProviderModelCatalog(providers, { refreshTtlMs: 50 });

    expect(catalog.isStale('claude')).toBe(true);
    expect(catalog.isStale('unknown')).toBe(false);

    const adapter = makeAdapter('claude', async () => ['opus']);
    await catalog.refresh([adapter]);

    expect(catalog.isStale('claude')).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(catalog.isStale('claude')).toBe(true);
  });

  it('lists entries from current in-memory state', async () => {
    const catalog = new ProviderModelCatalog(providers);

    const adapter = makeAdapter('codex', async () => ['foo', 'bar']);
    await catalog.refresh([adapter]);

    const entries = catalog.listForProvider('codex');
    const ids = entries.map((entry) => entry.modelId).sort();
    expect(ids).toEqual(['bar', 'foo']);
    expect(entries[0]?.canonicalRef).toMatch(/^codex\//);
  });

  it('refreshes a single provider via refreshProvider', async () => {
    const catalog = new ProviderModelCatalog(providers);
    const adapter = makeAdapter('claude', async () => ['solo-opus']);

    await catalog.refreshProvider(adapter);

    expect(catalog.has('claude', 'solo-opus')).toBe(true);
    expect(catalog.sourceFor('codex')).toBe('static');
  });
});
