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
  const parseRecord = (record: Record<string, unknown>) =>
    parseClaudeCodeOutput(JSON.stringify(record));

  it('ignores invalid JSON lines and reads alternate result fields', () => {
    const output = parseClaudeCodeOutput(`not-json
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
      parseRecord({
        error: {
          message: 'model unavailable',
        },
      })
    ).toThrow('model unavailable');
  });

  it('throws string Claude Code errors when no text was produced', () => {
    expect(() => parseRecord({ error: 'permission denied' })).toThrow(
      'permission denied'
    );
  });

  it('stringifies unstructured error events when no message is present', () => {
    expect(() => parseRecord({ code: 123, type: 'error' })).toThrow(
      '{"code":123,"type":"error"}'
    );
  });

  it('infers total tokens from positive input and output counts', () => {
    expect(
      parseRecord({
        result: 'done',
        usage: {
          input_tokens: 3,
          output_tokens: 4,
        },
      })
    ).toEqual({
      text: 'done',
      usage: {
        completionTokens: 4,
        promptTokens: 3,
        totalTokens: 7,
      },
    });
  });

  it('ignores usage records without positive token counts', () => {
    expect(
      parseRecord({
        result: 'done',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      })
    ).toEqual({
      text: 'done',
      usage: undefined,
    });
  });

  it('returns empty text when there are no parseable result records', () => {
    expect(parseClaudeCodeOutput('[]\n42\n')).toEqual({
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

  it('passes Claude model families as shorthand aliases', () => {
    const result = toClaudeCodeRunArgs({
      ...baseRequest,
      upstreamModel: 'claude-opus-5-0',
    });

    expect(result.args).toContain('opus');
    expect(result.args).not.toContain('claude-opus-5-0');
  });

  it('preserves image URL content parts as readable prompt text', () => {
    const result = toClaudeCodeRunArgs({
      ...baseRequest,
      messages: [
        {
          content: [
            { text: 'Review this:', type: 'text' },
            {
              image_url: { url: 'https://example.com/screenshot.png' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
    });

    expect(result.prompt).toBe(
      'user: Review this:\n[image_url: https://example.com/screenshot.png]'
    );
  });
});
