import type { AppConfig } from './schema.js';

export const defaultConfig: AppConfig = {
  models: {
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
