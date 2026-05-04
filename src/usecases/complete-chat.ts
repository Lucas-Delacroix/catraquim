import type {
  Adapter,
  ChatChunk,
  ChatRequest,
  ResolvedChatRequest,
  Usage,
} from '../adapters/base.js';
import type { ModelRegistry } from '../application/model-registry.js';
import { AppError, messageFromUnknownError } from '../errors.js';
import { logger } from '../logger.js';

export interface ChatCompletionResult {
  canonicalModel: string;
  content: string;
  finishReason: string | null;
  providerId: string;
  requestedModel: string;
  usage?: Usage;
}

interface ExecutionContext {
  provider: Adapter;
  request: ResolvedChatRequest;
}

const findFirstStop = (content: string, stopSequences: string[]) => {
  let firstIndex = -1;

  for (const stop of stopSequences) {
    const index = content.indexOf(stop);
    if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  return firstIndex;
};

const longestStopPrefixSuffixLength = (
  content: string,
  stopSequences: string[]
) => {
  let longest = 0;

  for (const stop of stopSequences) {
    const maxLength = Math.min(stop.length - 1, content.length);
    for (let length = maxLength; length > longest; length--) {
      if (content.endsWith(stop.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }

  return longest;
};

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

  public resolveModel(model: string) {
    return this.modelRegistry.resolve(model);
  }

  private resolveExecutionContext(request: ChatRequest): ExecutionContext {
    const binding = this.modelRegistry.resolve(request.model);
    const provider = this.providersById.get(binding.providerId);

    if (!provider) {
      throw AppError.configuration(
        `No provider configured for model "${request.model}"`,
        404,
        undefined,
        {
          canonicalModel: binding.canonicalModel,
          code: 'provider_not_configured',
          providerId: binding.providerId,
          requestedModel: request.model,
        }
      );
    }

    return {
      provider,
      request: {
        ...request,
        canonicalModel: binding.canonicalModel,
        providerId: binding.providerId,
        upstreamModel: binding.upstreamModel,
      },
    };
  }

  private toExecutionError(
    error: unknown,
    request: ResolvedChatRequest
  ): AppError {
    const metadata = {
      canonicalModel: request.canonicalModel,
      providerId: request.providerId,
      requestedModel: request.model,
    };

    if (error instanceof AppError) {
      return AppError.enrich(error, metadata);
    }

    return AppError.provider(
      messageFromUnknownError(error, 'Provider request failed'),
      502,
      error,
      {
        ...metadata,
        code: 'provider_request_failed',
      }
    );
  }

  private async *streamCompletion(
    context: ExecutionContext,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    try {
      if (!context.request.stop?.length) {
        yield* context.provider.chat(context.request, signal);
        return;
      }

      let buffer = '';
      let pendingFinishReason: string | undefined;
      let pendingUsage: Usage | undefined;

      for await (const chunk of context.provider.chat(
        context.request,
        signal
      )) {
        buffer += chunk.delta;
        pendingFinishReason = chunk.finishReason ?? pendingFinishReason;
        pendingUsage = chunk.usage ?? pendingUsage;

        const stopIndex = findFirstStop(buffer, context.request.stop);
        if (stopIndex !== -1) {
          yield {
            delta: buffer.slice(0, stopIndex),
            finishReason: 'stop',
            usage: pendingUsage,
          };
          return;
        }

        const retainedLength = longestStopPrefixSuffixLength(
          buffer,
          context.request.stop
        );
        const flushLength = buffer.length - retainedLength;

        if (flushLength > 0) {
          const canFinish = retainedLength === 0;
          yield {
            delta: buffer.slice(0, flushLength),
            ...(canFinish ? { finishReason: pendingFinishReason } : {}),
            ...(canFinish ? { usage: pendingUsage } : {}),
          };
          buffer = buffer.slice(flushLength);

          if (canFinish) {
            pendingFinishReason = undefined;
            pendingUsage = undefined;
          }
        }
      }

      if (buffer || pendingFinishReason || pendingUsage) {
        yield {
          delta: buffer,
          finishReason: pendingFinishReason,
          usage: pendingUsage,
        };
      }
    } catch (error) {
      throw this.toExecutionError(error, context.request);
    }
  }

  public stream(
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    return this.streamCompletion(this.resolveExecutionContext(request), signal);
  }

  public async execute(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatCompletionResult> {
    const context = this.resolveExecutionContext(request);
    let content = '';
    let finishReason: string | null = null;
    let usage: Usage | undefined;

    for await (const chunk of this.streamCompletion(context, signal)) {
      content += chunk.delta;
      finishReason = chunk.finishReason ?? finishReason;
      usage = chunk.usage ?? usage;
    }

    logger.info(
      {
        canonicalModel: context.request.canonicalModel,
        finishReason,
        provider: context.request.providerId,
        requestedModel: context.request.model,
        usage,
      },
      'Chat completion completed'
    );

    return {
      canonicalModel: context.request.canonicalModel,
      content,
      finishReason,
      providerId: context.request.providerId,
      requestedModel: context.request.model,
      usage,
    };
  }
}
