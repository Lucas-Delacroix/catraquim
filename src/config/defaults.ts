import type { AppConfig } from './schema.js';

export const defaultConfig: AppConfig = {
  models: {
    'claude-opus': {
      adapter: 'claude-code',
      upstreamModel: 'claude-opus-4-7',
    },
    'claude-sonnet': {
      adapter: 'claude-code',
      upstreamModel: 'claude-sonnet-4-6',
    },
    'codex-max': {
      adapter: 'codex',
      upstreamModel: 'codex-max',
    },
    'codex-mini': {
      adapter: 'codex',
      upstreamModel: 'codex-mini',
    },
  },
  providers: {
    'claude-code': {
      type: 'claude-code',
      binary: 'claude',
      homePath: '~/.claude',
    },
    codex: {
      type: 'codex',
      binary: 'codex',
      homePath: '~/.codex',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4141,
    token: null,
  },
};
