import { describe, expect, it } from 'vitest';

import type { ResolvedChatRequest } from '../../src/adapters/base.js';
import { parseClaudeCodeOutput } from '../../src/adapters/claude-code/output.js';
import { toClaudeCodeRunArgs } from '../../src/adapters/claude-code/request-mapper.js';

const baseRequest: ResolvedChatRequest = {
  canonicalModel: 'claude-code/custom-model',
  messages: [{ content: 'hello', role: 'user' }],
  model: 'custom',
  providerId: 'claude-code',
  stream: false,
  upstreamModel: 'custom-model',
};

describe('parseClaudeCodeOutput', () => {
  it('ignores invalid JSON lines and reads alternate result/session fields', () => {
    const output = parseClaudeCodeOutput(`not-json
      ${JSON.stringify({ conversationId: ' convo-1 ' })}
      ${JSON.stringify({
        result: ' final answer ',
        usage: {
          input_tokens: 0,
          output_tokens: 4,
          total_tokens: 10,
        },
      })}
    `);

    expect(output).toEqual({
      sessionId: 'convo-1',
      text: 'final answer',
      usage: {
        completionTokens: 4,
        promptTokens: undefined,
        totalTokens: 10,
      },
    });
  });

  it('throws nested Claude Code error messages when no text was produced', () => {
    expect(() =>
      parseClaudeCodeOutput(
        JSON.stringify({
          error: {
            message: 'model unavailable',
          },
        })
      )
    ).toThrow('model unavailable');
  });

  it('stringifies unstructured error events when no message is present', () => {
    expect(() =>
      parseClaudeCodeOutput(JSON.stringify({ code: 123, type: 'error' }))
    ).toThrow('{"code":123,"type":"error"}');
  });

  it('returns empty text when there are no parseable result records', () => {
    expect(parseClaudeCodeOutput('[]\n42\n')).toEqual({
      sessionId: undefined,
      text: '',
      usage: undefined,
    });
  });
});

describe('toClaudeCodeRunArgs', () => {
  it('uses raw model names and content fallback when all messages are system messages', () => {
    const result = toClaudeCodeRunArgs({
      ...baseRequest,
      messages: [{ content: 'system only', role: 'system' }],
    });

    expect(result.prompt).toBe('system only');
    expect(result.args).toContain('custom-model');
    expect(result.args).toContain('--append-system-prompt');
    expect(result.args).toContain('system only');
  });

  it('omits system prompt arguments when no system messages are present', () => {
    const result = toClaudeCodeRunArgs(baseRequest);

    expect(result.prompt).toBe('user: hello');
    expect(result.args).not.toContain('--append-system-prompt');
  });
});
