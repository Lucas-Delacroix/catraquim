import { describe, expect, it, vi } from 'vitest';

import {
  createNotImplementedStreamPayload,
  toOpenAiChatCompletion,
} from '../src/sse/openai-stream.js';

describe('OpenAI stream response helpers', () => {
  it('maps an internal chat completion result to the OpenAI response shape', () => {
    vi.setSystemTime(new Date('2026-04-23T12:34:56Z'));

    expect(
      toOpenAiChatCompletion({
        canonicalModel: 'codex/codex-max',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
        usage: {
          completionTokens: 2,
          promptTokens: 3,
          totalTokens: 5,
        },
      })
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
      id: 'chatcmpl_stub',
      model: 'codex/codex-max',
      object: 'chat.completion',
      usage: {
        completionTokens: 2,
        promptTokens: 3,
        totalTokens: 5,
      },
    });

    vi.useRealTimers();
  });

  it('includes provider metadata in not-implemented stream payloads when a binding is known', () => {
    expect(
      createNotImplementedStreamPayload('codex-max', {
        canonicalModel: 'codex/codex-max',
        providerConfig: {
          binary: 'codex',
          homePath: '~/.codex',
          type: 'codex',
        },
        providerId: 'codex',
        requestedModel: 'codex-max',
        upstreamModel: 'codex-max',
      })
    ).toEqual({
      error: {
        canonical_model: 'codex/codex-max',
        message: 'Streaming is not implemented yet for model "codex-max"',
        provider: 'codex',
        requested_model: 'codex-max',
        type: 'not_implemented',
      },
    });
  });

  it('keeps not-implemented stream payloads minimal without a model binding', () => {
    expect(createNotImplementedStreamPayload('unknown')).toEqual({
      error: {
        message: 'Streaming is not implemented yet for model "unknown"',
        requested_model: 'unknown',
        type: 'not_implemented',
      },
    });
  });
});
