import type { AppConfig } from './schema.js';

export const defaultConfig: AppConfig = {
  codex: {
    binary: 'codex',
    codexHomeSource: '~/.codex',
  },
  models: {
    'gpt-5': {
      adapter: 'codex',
      upstreamModel: 'gpt-5',
    },
    'gpt-5-codex': {
      adapter: 'codex',
      upstreamModel: 'gpt-5',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4141,
    token: null,
  },
};
