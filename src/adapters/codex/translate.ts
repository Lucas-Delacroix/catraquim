import type { ChatRequest } from '../base.js';

export const toCodexChatRequest = (request: ChatRequest) => {
  return {
    input: request.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    model: request.model,
    stream: request.stream,
    temperature: request.temperature,
  };
};
