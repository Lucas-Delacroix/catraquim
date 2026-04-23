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

export class ProviderModelCatalog {
  public constructor(private readonly providers: AppConfig['providers']) {}

  public list(): ProviderCatalogEntry[] {
    return Object.entries(this.providers).flatMap(([providerId, provider]) => {
      switch (provider.type) {
        case 'codex':
          return CODEX_MODEL_IDS.map((modelId) => ({
            canonicalRef: modelKey(providerId, modelId),
            modelId,
            providerId,
          }));
        default:
          return [];
      }
    });
  }
}
