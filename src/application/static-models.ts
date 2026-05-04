import type { AppConfig } from '../config/schema.js';

export const STATIC_CODEX_MODEL_IDS = [
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

export const STATIC_CLAUDE_CODE_MODEL_IDS = [
  'opus',
  'sonnet',
  'haiku',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
] as const;

type ProviderType = AppConfig['providers'][string]['type'];

const STATIC_MODEL_IDS_BY_PROVIDER_TYPE = {
  'claude-code': STATIC_CLAUDE_CODE_MODEL_IDS,
  codex: STATIC_CODEX_MODEL_IDS,
} satisfies Record<ProviderType, readonly string[]>;

export const staticModelIdsForProviderType = (
  type: ProviderType
): readonly string[] => STATIC_MODEL_IDS_BY_PROVIDER_TYPE[type];
