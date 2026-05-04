import { describe, expect, it, vi } from 'vitest';

import {
  generateChatCompletionId,
  toOpenAiChatCompletion,
  toOpenAiStreamChunk,
  toOpenAiStreamStartChunk,
} from '../src/sse/openai-stream.js';

describe('OpenAI stream response helpers', () => {
  it('generates OpenAI-compatible chat completion ids', () => {
    expect(generateChatCompletionId()).toMatch(
      /^chatcmpl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('maps an internal chat completion result to the OpenAI response shape', () => {
    vi.setSystemTime(new Date('2026-04-23T12:34:56Z'));

    expect(
      toOpenAiChatCompletion(
        {
          canonicalModel: 'codex/gpt-5.4',
          content: 'hello',
          finishReason: 'stop',
          providerId: 'codex',
          requestedModel: 'codex-max',
          usage: {
            completionTokens: 2,
            promptTokens: 3,
            totalTokens: 5,
          },
        },
        'chatcmpl_123'
      )
    ).toEqual({
      choices: [
        {
          finish_reason: 'stop',
          index: 0,
          message: {
            content: 'hello',
            role: 'assistant',
          },
        },
      ],
      created: 1776947696,
      id: 'chatcmpl_123',
      model: 'codex/gpt-5.4',
      object: 'chat.completion',
      usage: {
        completion_tokens: 2,
        prompt_tokens: 3,
        total_tokens: 5,
      },
    });

    vi.useRealTimers();
  });

  it('maps stream chunk usage to OpenAI snake_case token fields', () => {
    vi.setSystemTime(new Date('2026-04-23T12:34:56Z'));

    expect(
      toOpenAiStreamChunk(
        {
          delta: '',
          finishReason: 'stop',
          usage: {
            completionTokens: 2,
            promptTokens: 3,
            totalTokens: 5,
          },
        },
        'codex/gpt-5.4',
        'chatcmpl_123'
      )
    ).toEqual({
      choices: [
        {
          delta: {},
          finish_reason: 'stop',
          index: 0,
        },
      ],
      created: 1776947696,
      id: 'chatcmpl_123',
      model: 'codex/gpt-5.4',
      object: 'chat.completion.chunk',
      usage: {
        completion_tokens: 2,
        prompt_tokens: 3,
        total_tokens: 5,
      },
    });

    vi.useRealTimers();
  });

  it('creates an initial stream chunk with the assistant role', () => {
    vi.setSystemTime(new Date('2026-04-23T12:34:56Z'));

    expect(toOpenAiStreamStartChunk('codex/gpt-5.4', 'chatcmpl_123')).toEqual({
      choices: [
        {
          delta: {
            role: 'assistant',
          },
          finish_reason: null,
          index: 0,
        },
      ],
      created: 1776947696,
      id: 'chatcmpl_123',
      model: 'codex/gpt-5.4',
      object: 'chat.completion.chunk',
    });

    vi.useRealTimers();
  });
});
