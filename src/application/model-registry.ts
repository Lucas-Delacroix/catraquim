import type { AppConfig } from '../config/schema.js';
import { AppError } from '../errors.js';
import { modelKey, parseModelRef } from './model-ref.js';
import { ProviderModelCatalog } from './provider-model-catalog.js';

export interface ModelBinding {
  canonicalModel: string;
  gatewayModel: string;
  providerId: string;
  upstreamModel: string;
}

export interface ModelDefinition {
  canonicalRef: string;
  id: string;
  providerId: string;
  upstreamModel: string;
}

export class ModelRegistry {
  private readonly providerModelCatalog: ProviderModelCatalog;

  public constructor(
    private readonly models: AppConfig['models'],
    private readonly providers: AppConfig['providers'],
    providerModelCatalog?: ProviderModelCatalog
  ) {
    this.providerModelCatalog =
      providerModelCatalog ?? new ProviderModelCatalog(providers);
  }

  public list(): ModelDefinition[] {
    return Object.entries(this.models).map(([id, definition]) => ({
      canonicalRef: modelKey(definition.adapter, definition.upstreamModel),
      id,
      providerId: definition.adapter,
      upstreamModel: definition.upstreamModel,
    }));
  }

  public resolve(model: string): ModelBinding {
    const definition = this.models[model];
    if (definition) {
      return {
        canonicalModel: modelKey(definition.adapter, definition.upstreamModel),
        gatewayModel: model,
        providerId: definition.adapter,
        upstreamModel: definition.upstreamModel,
      };
    }

    const directRef = parseModelRef(model);
    if (
      directRef &&
      this.providers[directRef.providerId] &&
      this.providerModelCatalog.has(directRef.providerId, directRef.model)
    ) {
      return {
        canonicalModel: modelKey(directRef.providerId, directRef.model),
        gatewayModel: model,
        providerId: directRef.providerId,
        upstreamModel: directRef.model,
      };
    }

    throw AppError.compatibility(`Unknown model: ${model}`, 400, undefined, {
      code: 'unknown_model',
      requestedModel: model,
    });
  }

  public hasProvider(providerId: string): boolean {
    return providerId in this.providers;
  }

  public listCanonicalRefs(): string[] {
    return this.list().map((definition) => definition.canonicalRef);
  }
}
