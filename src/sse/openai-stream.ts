import type { ChatCompletionResult } from '../usecases/complete-chat.js';

export const toOpenAiChatCompletion = (
  model: string,
  completion: ChatCompletionResult
) => {
  return {
    id: 'chatcmpl_stub',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
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
    usage: completion.usage,
  };
};

export const createNotImplementedStreamPayload = (model: string) => {
  return {
    error: {
      message: `Streaming is not implemented yet for model "${model}"`,
      type: 'not_implemented',
    },
  };
};
