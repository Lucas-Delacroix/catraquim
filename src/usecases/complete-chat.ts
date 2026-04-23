import type {
  Adapter,
  ChatChunk,
  ChatRequest,
  ResolvedChatRequest,
  Usage,
} from '../adapters/base.js';
import type { ModelRegistry } from '../application/model-registry.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export interface ChatCompletionResult {
  canonicalModel: string;
  content: string;
  finishReason: string | null;
  providerId: string;
  requestedModel: string;
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

  public resolveModel(model: string) {
    return this.modelRegistry.resolve(model);
  }

  private resolveExecution(request: ChatRequest): {
    provider: Adapter;
    resolvedRequest: ResolvedChatRequest;
  } {
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
      resolvedRequest: {
        ...request,
        canonicalModel: binding.canonicalModel,
        providerId: binding.providerId,
        upstreamModel: binding.upstreamModel,
      },
    };
  }

  private toExecutionError(
    error: unknown,
    resolvedRequest: ResolvedChatRequest
  ): AppError {
    const metadata = {
      canonicalModel: resolvedRequest.canonicalModel,
      providerId: resolvedRequest.providerId,
      requestedModel: resolvedRequest.model,
    };

    if (error instanceof AppError) {
      return AppError.enrich(error, metadata);
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Provider request failed';

    return AppError.provider(message, 502, error, {
      ...metadata,
      code: 'provider_request_failed',
    });
  }

  public stream(
    request: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const { provider, resolvedRequest } = this.resolveExecution(request);

    return {
      [Symbol.asyncIterator]: async function* (
        this: CompleteChatUseCase
      ): AsyncIterable<ChatChunk> {
        try {
          yield* provider.chat(resolvedRequest, signal);
        } catch (error) {
          throw this.toExecutionError(error, resolvedRequest);
        }
      }.bind(this),
    };
  }

  public async execute(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatCompletionResult> {
    const { provider, resolvedRequest } = this.resolveExecution(request);
    let content = '';
    let finishReason: string | null = null;
    let usage: Usage | undefined;

    try {
      for await (const chunk of provider.chat(resolvedRequest, signal)) {
        content += chunk.delta;
        finishReason = chunk.finishReason ?? finishReason;
        usage = chunk.usage ?? usage;
      }
    } catch (error) {
      throw this.toExecutionError(error, resolvedRequest);
    }

    logger.info(
      {
        canonicalModel: resolvedRequest.canonicalModel,
        finishReason,
        provider: resolvedRequest.providerId,
        requestedModel: resolvedRequest.model,
        usage,
      },
      'Chat completion completed'
    );

    return {
      canonicalModel: resolvedRequest.canonicalModel,
      content,
      finishReason,
      providerId: resolvedRequest.providerId,
      requestedModel: resolvedRequest.model,
      usage,
    };
  }
}
