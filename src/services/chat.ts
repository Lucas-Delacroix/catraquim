import type { ChatChunk, ChatRequest } from '../adapters/base.js';
import type { CompleteChatUseCase } from '../usecases/complete-chat.js';
export type { ChatCompletionResult } from '../usecases/complete-chat.js';

export class ChatService {
  public constructor(private readonly completeChat: CompleteChatUseCase) {}

  public stream(
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    return this.completeChat.stream(request, signal);
  }

  public async complete(request: ChatRequest, signal: AbortSignal) {
    return this.completeChat.execute(request, signal);
  }
}
