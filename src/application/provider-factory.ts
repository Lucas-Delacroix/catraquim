import type { Adapter } from '../adapters/base.js';
import { CodexAdapter } from '../adapters/codex/index.js';
import type { AppConfig } from '../config/schema.js';
import { AppError } from '../errors.js';

export class ProviderFactory {
  public create(config: AppConfig): Adapter[] {
    return Object.entries(config.providers).map(
      ([providerId, providerConfig]) => {
        switch (providerConfig.type) {
          case 'codex':
            return new CodexAdapter(providerId, providerConfig);
          default:
            throw new AppError(
              `Unsupported provider type: ${(providerConfig as { type: string }).type}`,
              500
            );
        }
      }
    );
  }
}
