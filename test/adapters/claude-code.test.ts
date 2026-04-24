import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedChatRequest } from '../../src/adapters/base.js';
import { runClaudeCode } from '../../src/adapters/claude-code/run.js';
import { getClaudeCodeAuthStatus } from '../../src/credentials/claude-code.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/credentials/keychain.js', () => ({
  readMacOsKeychainSecret: vi.fn(() => null),
}));

class MockClaudeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn();
  readonly stdinChunks: string[] = [];

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      this.stdinChunks.push(chunk.toString('utf8'));
    });
  }
}

const mockSpawn = spawn as ReturnType<typeof vi.fn>;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const config = {
  binary: 'claude',
  homePath: '/tmp/catraquim-claude-home',
  type: 'claude-code' as const,
};

const request: ResolvedChatRequest = {
  canonicalModel: 'claude-code/claude-sonnet-4-6',
  messages: [
    { content: 'You are concise.', role: 'system' },
    { content: 'hello', role: 'user' },
  ],
  model: 'claude-sonnet',
  providerId: 'claude-code',
  stream: false,
  upstreamModel: 'claude-sonnet-4-6',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'host-secret';
});

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
});

describe('runClaudeCode', () => {
  it('rejects without spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runClaudeCode(config, request, controller.signal)
    ).rejects.toMatchObject({
      code: 'run_aborted',
      statusCode: 499,
      type: 'transient_error',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns Claude Code in stream-json mode and parses the result', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.stdout.push(
      `${JSON.stringify({ type: 'init', session_id: 's1' })}\n`
    );
    child.stdout.push(
      `${JSON.stringify({
        result: 'Claude says hi',
        type: 'result',
        usage: {
          input_tokens: 12,
          output_tokens: 3,
        },
      })}\n`
    );
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      text: 'Claude says hi',
      usage: {
        completionTokens: 3,
        promptTokens: 12,
        totalTokens: 15,
      },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '-p',
        '--output-format',
        'stream-json',
        '--setting-sources',
        'user',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        'sonnet',
        '--append-system-prompt',
        'You are concise.',
      ]),
      expect.objectContaining({
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    const spawnOptions = mockSpawn.mock.calls[0]?.[2] as
      | { env?: NodeJS.ProcessEnv }
      | undefined;
    expect(spawnOptions?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(spawnOptions?.env?.CLAUDE_CONFIG_DIR).toBe(
      '/tmp/catraquim-claude-home'
    );
    expect(child.stdinChunks.join('')).toBe('user: hello\n');
  });

  it('returns provider errors from stderr on non-zero exit', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.stderr.push('auth failed');
    child.emit('close', 1);

    await expect(resultPromise).rejects.toMatchObject({
      code: 'process_exit',
      message: 'auth failed',
      statusCode: 502,
      type: 'provider_error',
    });
  });

  it('returns a default provider error when Claude Code exits without stderr', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.emit('close', null);

    await expect(resultPromise).rejects.toMatchObject({
      code: 'process_exit',
      details: { code: null },
      message: 'Claude Code exited with status null',
      statusCode: 502,
      type: 'provider_error',
    });
  });

  it('classifies missing Claude Code binaries as configuration errors', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.emit(
      'error',
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );

    await expect(resultPromise).rejects.toMatchObject({
      code: 'binary_not_found',
      details: { binary: 'claude' },
      message: 'Claude Code binary not found: claude',
      statusCode: 500,
      type: 'configuration_error',
    });
  });

  it('classifies other spawn errors as transient process errors', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.emit('error', Object.assign(new Error('busy'), { code: 'EAGAIN' }));

    await expect(resultPromise).rejects.toMatchObject({
      code: 'process_error',
      message: 'Claude Code process error',
      statusCode: 502,
      transient: true,
      type: 'transient_error',
    });
  });

  it('kills the Claude Code process and rejects when aborted while running', async () => {
    const child = new MockClaudeProcess();
    const controller = new AbortController();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(config, request, controller.signal);
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      code: 'run_aborted',
      statusCode: 499,
      type: 'transient_error',
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('wraps parse failures from successful Claude Code exits', async () => {
    const child = new MockClaudeProcess();
    mockSpawn.mockReturnValue(child);

    const resultPromise = runClaudeCode(
      config,
      request,
      new AbortController().signal
    );

    child.stdout.push(
      `${JSON.stringify({ message: 'bad jsonl', type: 'error' })}\n`
    );
    child.emit('close', 0);

    await expect(resultPromise).rejects.toMatchObject({
      code: 'output_parse_failed',
      message: 'Failed to parse Claude Code output',
      statusCode: 502,
      type: 'provider_error',
    });
  });
});

describe('getClaudeCodeAuthStatus', () => {
  it('reads Claude Code file credentials', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'catraquim-claude-auth-'));

    try {
      writeFileSync(
        join(dir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'access-token',
            expiresAt: Date.UTC(2030, 0, 1),
            refreshToken: 'refresh-token',
          },
        }),
        'utf8'
      );

      await expect(getClaudeCodeAuthStatus(dir)).resolves.toEqual({
        expiresAt: '2030-01-01T00:00:00.000Z',
        ok: true,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
