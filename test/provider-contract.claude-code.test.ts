import { beforeEach, vi } from 'vitest';

const runClaudeCodeMock = vi.hoisted(() => vi.fn());
const getClaudeCodeAuthStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../src/adapters/claude-code/run.js', () => ({
  runClaudeCode: runClaudeCodeMock,
}));

vi.mock('../src/credentials/claude-code.js', () => ({
  getClaudeCodeAuthStatus: getClaudeCodeAuthStatusMock,
}));

import { ClaudeCodeAdapter } from '../src/adapters/claude-code/index.js';
import { defaultConfig } from '../src/config/defaults.js';
import { defineProviderContract } from './provider-contract-kit.js';

const providerConfig = defaultConfig.providers['claude-code'];
const contractConfig = {
  ...defaultConfig,
  models: {
    assistant: {
      adapter: 'claude-code',
      upstreamModel: 'claude-sonnet-4-6',
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  runClaudeCodeMock.mockResolvedValue({ text: 'hello from claude' });
  getClaudeCodeAuthStatusMock.mockResolvedValue({
    expiresAt: '2030-01-01T00:00:00.000Z',
    ok: true,
  });
});

defineProviderContract('claude-code', {
  alias: 'assistant',
  canonicalModel: 'claude-code/claude-sonnet-4-6',
  config: contractConfig,
  createAdapter: () => new ClaudeCodeAdapter('claude-code', providerConfig),
  createFailureAdapter: () => {
    runClaudeCodeMock.mockRejectedValueOnce(new Error('claude exploded'));
    return new ClaudeCodeAdapter('claude-code', providerConfig);
  },
  expectedContent: 'hello from claude',
  expectedStatus: {
    expiresAt: '2030-01-01T00:00:00.000Z',
    id: 'claude-code',
    ok: true,
  },
  providerId: 'claude-code',
});
