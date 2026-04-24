import type { Adapter } from '../adapters/base.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { CodexAdapter } from '../adapters/codex/index.js';
import type { AppConfig } from '../config/schema.js';
import { AppError } from '../errors.js';

export class ProviderFactory {
  public create(config: AppConfig): Adapter[] {
    return Object.entries(config.providers).map(
      ([providerId, providerConfig]) => {
        switch (providerConfig.type) {
          case 'claude-code':
            return new ClaudeCodeAdapter(providerId, providerConfig);
          case 'codex':
            return new CodexAdapter(providerId, providerConfig);
          default:
            throw AppError.configuration(
              `Unsupported provider type: ${(providerConfig as { type: string }).type}`,
              500,
              undefined,
              {
                code: 'unsupported_provider_type',
                details: {
                  type: (providerConfig as { type: string }).type,
                },
                providerId,
              }
            );
        }
      }
    );
  }
}
