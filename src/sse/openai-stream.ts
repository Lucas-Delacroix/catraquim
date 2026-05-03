import { randomUUID } from 'node:crypto';

import type { ChatChunk } from '../adapters/base.js';
import type { ModelBinding } from '../application/model-registry.js';
import type { ChatCompletionResult } from '../usecases/complete-chat.js';

const toOpenAiUsage = (usage: ChatCompletionResult['usage']) => {
  if (!usage) return undefined;

  return {
    completion_tokens: usage.completionTokens,
    prompt_tokens: usage.promptTokens,
    total_tokens: usage.totalTokens,
  };
};

export const generateChatCompletionId = () => `chatcmpl_${randomUUID()}`;

export const toOpenAiChatCompletion = (
  completion: ChatCompletionResult,
  id: string
) => {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: completion.canonicalModel,
    choices: [
      {
        index: 0,
        finish_reason: completion.finishReason,
        message: {
          role: 'assistant',
          content: completion.content,
        },
      },
    ],
    usage: toOpenAiUsage(completion.usage),
  };
};

export const createNotImplementedStreamPayload = (
  requestedModel: string,
  binding?: ModelBinding
) => {
  return {
    error: {
      ...(binding ? { canonical_model: binding.canonicalModel } : {}),
      message: `Streaming is not implemented yet for model "${requestedModel}"`,
      ...(binding ? { provider: binding.providerId } : {}),
      requested_model: requestedModel,
      type: 'not_implemented',
    },
  };
};

export const toOpenAiStreamStartChunk = (model: string, id: string) => {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  };
};

export const toOpenAiStreamChunk = (
  chunk: ChatChunk,
  model: string,
  id: string
) => {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: chunk.delta ? { content: chunk.delta } : {},
        finish_reason: chunk.finishReason ?? null,
      },
    ],
    ...(chunk.usage ? { usage: toOpenAiUsage(chunk.usage) } : {}),
  };
};
