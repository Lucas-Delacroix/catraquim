import type { CodexProviderConfig, ProviderConfig } from './schema.js';

export interface ProviderEntry<
  TConfig extends ProviderConfig = ProviderConfig,
> {
  config: TConfig;
  id: string;
}

export const providerEntries = (providers: Record<string, ProviderConfig>) =>
  Object.entries(providers).map(([id, config]) => ({ config, id }));

export const findFirstProviderByType = <TType extends ProviderConfig['type']>(
  providers: Record<string, ProviderConfig>,
  type: TType
): ProviderEntry<Extract<ProviderConfig, { type: TType }>> | undefined => {
  return providerEntries(providers).find(
    (entry): entry is ProviderEntry<Extract<ProviderConfig, { type: TType }>> =>
      entry.config.type === type
  );
};

export const defaultCodexProvider = (): ProviderEntry<CodexProviderConfig> => ({
  config: {
    type: 'codex',
    binary: 'codex',
    homePath: '~/.codex',
  },
  id: 'codex',
});
