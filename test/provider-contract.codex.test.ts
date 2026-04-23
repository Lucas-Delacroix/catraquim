import { beforeEach, vi } from 'vitest';

const runTurnMock = vi.hoisted(() => vi.fn());
const getCodexAuthStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../src/adapters/codex/run-turn.js', () => ({
  runTurn: runTurnMock,
}));

vi.mock('../src/credentials/codex.js', () => ({
  getCodexAuthStatus: getCodexAuthStatusMock,
}));

import { CodexAdapter } from '../src/adapters/codex/index.js';
import { defaultConfig } from '../src/config/defaults.js';
import { defineProviderContract } from './provider-contract-kit.js';

const providerConfig = defaultConfig.providers.codex;
const contractConfig = {
  ...defaultConfig,
  models: {
    assistant: {
      adapter: 'codex',
      upstreamModel: 'gpt-5.4',
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  runTurnMock.mockResolvedValue({ text: 'hello from codex' });
  getCodexAuthStatusMock.mockResolvedValue({
    expiresAt: '2030-01-01T00:00:00.000Z',
    ok: true,
  });
});

defineProviderContract('codex', {
  alias: 'assistant',
  canonicalModel: 'codex/gpt-5.4',
  config: contractConfig,
  createAdapter: () => new CodexAdapter('codex', providerConfig),
  createFailureAdapter: () => {
    runTurnMock.mockRejectedValueOnce(new Error('transport exploded'));
    return new CodexAdapter('codex', providerConfig);
  },
  expectedContent: 'hello from codex',
  expectedStatus: {
    expiresAt: '2030-01-01T00:00:00.000Z',
    id: 'codex',
    ok: true,
  },
  providerId: 'codex',
});
