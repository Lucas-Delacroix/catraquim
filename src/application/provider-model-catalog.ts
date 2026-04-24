import type { Adapter } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { logger } from '../logger.js';
import { modelKey } from './model-ref.js';
import { staticModelIdsForProviderType } from './static-models.js';

export interface ProviderCatalogEntry {
  canonicalRef: string;
  modelId: string;
  providerId: string;
}

export interface ProviderModelCatalogOptions {
  refreshTtlMs?: number;
}

interface ProviderState {
  modelIds: Set<string>;
  source: 'static' | 'dynamic';
  lastRefreshedAt: number;
}

const DEFAULT_REFRESH_TTL_MS = 5 * 60 * 1000;

export class ProviderModelCatalog {
  private readonly providers: AppConfig['providers'];
  private readonly state = new Map<string, ProviderState>();
  private readonly refreshTtlMs: number;

  public constructor(
    providers: AppConfig['providers'],
    options: ProviderModelCatalogOptions = {}
  ) {
    this.providers = providers;
    this.refreshTtlMs = options.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;

    for (const [providerId, provider] of Object.entries(providers)) {
      this.state.set(providerId, {
        modelIds: new Set(staticModelIdsForProviderType(provider.type)),
        source: 'static',
        lastRefreshedAt: 0,
      });
    }
  }

  public list(): ProviderCatalogEntry[] {
    const entries: ProviderCatalogEntry[] = [];
    for (const [providerId, providerState] of this.state) {
      for (const modelId of providerState.modelIds) {
        entries.push({
          canonicalRef: modelKey(providerId, modelId),
          modelId,
          providerId,
        });
      }
    }
    return entries;
  }

  public listForProvider(providerId: string): ProviderCatalogEntry[] {
    const providerState = this.state.get(providerId);
    if (!providerState) return [];

    return Array.from(providerState.modelIds, (modelId) => ({
      canonicalRef: modelKey(providerId, modelId),
      modelId,
      providerId,
    }));
  }

  public has(providerId: string, modelId: string): boolean {
    return this.state.get(providerId)?.modelIds.has(modelId) ?? false;
  }

  public isStale(providerId: string, now: number = Date.now()): boolean {
    const providerState = this.state.get(providerId);
    if (!providerState) return false;
    return now - providerState.lastRefreshedAt >= this.refreshTtlMs;
  }

  public sourceFor(providerId: string): ProviderState['source'] | undefined {
    return this.state.get(providerId)?.source;
  }

  public async refresh(adapters: Adapter[]): Promise<void> {
    await Promise.all(adapters.map((adapter) => this.refreshProvider(adapter)));
  }

  public async refreshProvider(adapter: Adapter): Promise<void> {
    const providerState = this.state.get(adapter.id);
    if (!providerState) return;
    if (!adapter.listModels) return;

    try {
      const discovered = await adapter.listModels();
      const ids = discovered
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (ids.length === 0) return;

      providerState.modelIds = new Set(ids);
      providerState.source = 'dynamic';
      providerState.lastRefreshedAt = Date.now();

      logger.info(
        { count: ids.length, providerId: adapter.id },
        'Provider model catalog refreshed from adapter'
      );
    } catch (error) {
      logger.warn(
        { err: error, providerId: adapter.id },
        'Provider model discovery failed; keeping previous catalog entries'
      );
    }
  }
}
