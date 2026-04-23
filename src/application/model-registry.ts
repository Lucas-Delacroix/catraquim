import type { AppConfig } from '../config/schema.js';
import { AppError } from '../errors.js';
import { modelKey, parseModelRef } from './model-ref.js';

export interface ModelBinding {
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
  public constructor(
    private readonly models: AppConfig['models'],
    private readonly providers: AppConfig['providers']
  ) {}

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
        gatewayModel: model,
        providerId: definition.adapter,
        upstreamModel: definition.upstreamModel,
      };
    }

    const directRef = parseModelRef(model);
    if (directRef && this.providers[directRef.providerId]) {
      return {
        gatewayModel: model,
        providerId: directRef.providerId,
        upstreamModel: directRef.model,
      };
    }

    throw new AppError(`Unknown model: ${model}`, 400);
  }

  public hasProvider(providerId: string): boolean {
    return providerId in this.providers;
  }

  public listCanonicalRefs(): string[] {
    return this.list().map((definition) => definition.canonicalRef);
  }
}
