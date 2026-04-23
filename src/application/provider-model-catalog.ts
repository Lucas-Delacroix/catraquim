import type { AppConfig } from '../config/schema.js';
import { modelKey } from './model-ref.js';

export interface ProviderCatalogEntry {
  canonicalRef: string;
  modelId: string;
  providerId: string;
}

const CODEX_MODEL_IDS = [
  'codex-max',
  'codex-mini',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-pro',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2-codex',
  'gpt-5.1-codex',
] as const;

const modelIdsForProviderType = (
  type: AppConfig['providers'][string]['type']
) => {
  switch (type) {
    case 'codex':
      return CODEX_MODEL_IDS;
    default:
      return [];
  }
};

export class ProviderModelCatalog {
  private readonly entries: ProviderCatalogEntry[];
  private readonly modelIdsByProvider: ReadonlyMap<string, ReadonlySet<string>>;

  public constructor(providers: AppConfig['providers']) {
    this.entries = Object.entries(providers).flatMap(([providerId, provider]) =>
      modelIdsForProviderType(provider.type).map((modelId) => ({
        canonicalRef: modelKey(providerId, modelId),
        modelId,
        providerId,
      }))
    );
    this.modelIdsByProvider = new Map(
      Object.entries(providers).map(([providerId, provider]) => [
        providerId,
        new Set(modelIdsForProviderType(provider.type)),
      ])
    );
  }

  public list(): ProviderCatalogEntry[] {
    return this.entries;
  }

  public listForProvider(providerId: string): ProviderCatalogEntry[] {
    return this.entries.filter((entry) => entry.providerId === providerId);
  }

  public has(providerId: string, modelId: string): boolean {
    return this.modelIdsByProvider.get(providerId)?.has(modelId) ?? false;
  }
}
