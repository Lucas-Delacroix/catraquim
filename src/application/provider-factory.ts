import type { Adapter } from '../adapters/base.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { CodexAdapter } from '../adapters/codex/index.js';
import type { AppConfig } from '../config/schema.js';

export class ProviderFactory {
  public create(config: AppConfig): Adapter[] {
    return Object.entries(config.providers).map(
      ([providerId, providerConfig]) => {
        switch (providerConfig.type) {
          case 'claude-code':
            return new ClaudeCodeAdapter(providerId, providerConfig);
          case 'codex':
            return new CodexAdapter(providerId, providerConfig);
        }
      }
    );
  }
}
