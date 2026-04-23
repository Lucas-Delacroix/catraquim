import type {
  Adapter,
  ChatChunk,
  ChatRequest,
  Usage,
} from '../adapters/base.js';
import type { ModelRegistry } from '../application/model-registry.js';
import { AppError } from '../errors.js';

export interface ChatCompletionResult {
  content: string;
  finishReason: string | null;
  usage?: Usage;
}

export class CompleteChatUseCase {
  private readonly providersById: ReadonlyMap<string, Adapter>;

  public constructor(
    private readonly modelRegistry: ModelRegistry,
    providers: Adapter[]
  ) {
    this.providersById = new Map(
      providers.map((provider) => [provider.id, provider])
    );
  }

  public stream(
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const binding = this.modelRegistry.resolve(request.model);
    const provider = this.providersById.get(binding.providerId);

    if (!provider) {
      throw new AppError(
        `No provider configured for model "${request.model}"`,
        404
      );
    }

    return provider.chat(
      {
        ...request,
        providerId: binding.providerId,
        upstreamModel: binding.upstreamModel,
      },
      signal
    );
  }

  public async execute(
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
