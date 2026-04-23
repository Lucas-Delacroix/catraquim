import type { ModelRegistry } from '../application/model-registry.js';
import type { ProviderModelCatalog } from '../application/provider-model-catalog.js';

interface ListedModelEntry {
  canonical_ref: string;
  id: string;
  object: 'model';
  owned_by: string;
  source: 'configured-alias' | 'provider-catalog';
}

export class ListModelsUseCase {
  public constructor(
    private readonly modelRegistry: ModelRegistry,
    private readonly providerModelCatalog: ProviderModelCatalog
  ) {}

  private listConfiguredAliases(): ListedModelEntry[] {
    return this.modelRegistry.list().map((model) => ({
      canonical_ref: model.canonicalRef,
      id: model.id,
      object: 'model' as const,
      owned_by: model.providerId,
      source: 'configured-alias' as const,
    }));
  }

  private listProviderCatalogEntries(): ListedModelEntry[] {
    return this.providerModelCatalog.list().map((model) => ({
      canonical_ref: model.canonicalRef,
      id: model.canonicalRef,
      object: 'model' as const,
      owned_by: model.providerId,
      source: 'provider-catalog' as const,
    }));
  }

  private dedupe(entries: ListedModelEntry[]): ListedModelEntry[] {
    const seen = new Set<string>();

    return entries.filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);
      return true;
    });
  }

  public execute() {
    return this.dedupe([
      ...this.listConfiguredAliases(),
      ...this.listProviderCatalogEntries(),
    ]);
  }
}
