import type { AppConfig } from './schema.js';

export const defaultConfig: AppConfig = {
  codex: {
    binary: 'codex',
    codexHomeSource: '~/.codex',
  },
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
  server: {
    host: '127.0.0.1',
    port: 4141,
    token: null,
  },
};
