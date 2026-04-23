import type { ChatChunk, ChatRequest, Usage } from '../adapters/base.js';
import type { ServiceRouter } from './router.js';

export interface ChatCompletionResult {
  content: string;
  finishReason: string | null;
  usage?: Usage;
}

export class ChatService {
  public constructor(private readonly router: ServiceRouter) {}

  public stream(
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    return this.router.resolveAdapter(request.model).chat(request, signal);
  }

  public async complete(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatCompletionResult> {
    let content = '';
    let finishReason: string | null = null;
    let usage: Usage | undefined;

    for await (const chunk of this.stream(request, signal)) {
      content += chunk.delta;
      finishReason = chunk.finishReason ?? finishReason;
      usage = chunk.usage ?? usage;
    }

    return {
      content,
      finishReason,
      usage,
    };
  }
}
