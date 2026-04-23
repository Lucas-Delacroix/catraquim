import type { ModelRegistry } from '../application/model-registry.js';
import type { ProviderModelCatalog } from '../application/provider-model-catalog.js';

export class ListModelsUseCase {
  public constructor(
    private readonly modelRegistry: ModelRegistry,
    private readonly providerModelCatalog: ProviderModelCatalog
  ) {}

  public execute() {
    const entries = this.modelRegistry.list().map((model) => ({
      canonical_ref: model.canonicalRef,
      id: model.id,
      object: 'model' as const,
      owned_by: model.providerId,
      source: 'configured-alias' as const,
    }));
    const catalogEntries = this.providerModelCatalog.list().map((model) => ({
      canonical_ref: model.canonicalRef,
      id: model.canonicalRef,
      object: 'model' as const,
      owned_by: model.providerId,
      source: 'provider-catalog' as const,
    }));
    const seen = new Set<string>();

    return [...entries, ...catalogEntries].filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);
      return true;
    });
  }
}
