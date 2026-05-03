import { describe, expect, it } from 'vitest';

import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ResolvedChatRequest,
} from '../../src/adapters/base.js';
import { ModelRegistry } from '../../src/application/model-registry.js';
import { defaultConfig } from '../../src/config/defaults.js';
import { CompleteChatUseCase } from '../../src/usecases/complete-chat.js';

class FakeAdapter implements Adapter {
  public readonly id = 'fake';

  public async *chat(
    _req: ResolvedChatRequest,
    _signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    yield { delta: 'hello ' };
    yield { delta: 'world', finishReason: 'stop' };
  }

  public async status(): Promise<AdapterStatus> {
    return {
      id: this.id,
      ok: true,
    };
  }
}

describe('CompleteChatUseCase', () => {
  it('aggregates chunks for non-streaming responses', async () => {
    const registry = new ModelRegistry(
      {
        ...defaultConfig.models,
        'test-model': {
          adapter: 'fake',
          upstreamModel: 'fake-upstream',
        },
      },
      {
        ...defaultConfig.providers,
        fake: {
          type: 'codex',
          binary: 'fake',
          homePath: '~/.fake',
        },
      }
    );
    const useCase = new CompleteChatUseCase(registry, [new FakeAdapter()]);

    const result = await useCase.execute(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
        stream: false,
      },
      new AbortController().signal
    );

    expect(result.content).toBe('hello world');
    expect(result.canonicalModel).toBe('fake/fake-upstream');
    expect(result.finishReason).toBe('stop');
    expect(result.providerId).toBe('fake');
    expect(result.requestedModel).toBe('test-model');
  });

  it('applies OpenAI stop sequences across provider chunk boundaries', async () => {
    class StoppingAdapter extends FakeAdapter {
      public override async *chat(): AsyncIterable<ChatChunk> {
        yield { delta: 'hello <' };
        yield { delta: 'stop> ignored', finishReason: 'stop' };
      }
    }

    const registry = new ModelRegistry(
      {
        ...defaultConfig.models,
        'test-model': {
          adapter: 'fake',
          upstreamModel: 'fake-upstream',
        },
      },
      {
        ...defaultConfig.providers,
        fake: {
          type: 'codex',
          binary: 'fake',
          homePath: '~/.fake',
        },
      }
    );
    const useCase = new CompleteChatUseCase(registry, [new StoppingAdapter()]);

    const result = await useCase.execute(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
        stop: ['<stop>'],
        stream: false,
      },
      new AbortController().signal
    );

    expect(result.content).toBe('hello ');
    expect(result.finishReason).toBe('stop');
  });

  it('resolves direct provider/model refs without a configured alias', async () => {
    const seen: ResolvedChatRequest[] = [];

    class TrackingAdapter extends FakeAdapter {
      public override async *chat(
        req: ResolvedChatRequest,
        signal: AbortSignal
      ): AsyncIterable<ChatChunk> {
        seen.push(req);
        yield* super.chat(req, signal);
      }
    }

    const registry = new ModelRegistry(defaultConfig.models, {
      ...defaultConfig.providers,
      fake: {
        type: 'codex',
        binary: 'fake',
        homePath: '~/.fake',
      },
    });
    const useCase = new CompleteChatUseCase(registry, [new TrackingAdapter()]);

    await useCase.execute(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'fake/gpt-5.4',
        stream: false,
      },
      new AbortController().signal
    );

    expect(seen[0]).toMatchObject({
      canonicalModel: 'fake/gpt-5.4',
      model: 'fake/gpt-5.4',
      providerId: 'fake',
      upstreamModel: 'gpt-5.4',
    });
  });

  it('rejects direct provider/model refs that are not in the provider catalog', async () => {
    const registry = new ModelRegistry(defaultConfig.models, {
      ...defaultConfig.providers,
      fake: {
        type: 'codex',
        binary: 'fake',
        homePath: '~/.fake',
      },
    });
    const useCase = new CompleteChatUseCase(registry, [new FakeAdapter()]);

    await expect(
      useCase.execute(
        {
          messages: [{ content: 'hi', role: 'user' }],
          model: 'fake/not-in-catalog',
          stream: false,
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      code: 'unknown_model',
      requestedModel: 'fake/not-in-catalog',
      type: 'compatibility_error',
    });
  });

  it('enriches provider failures with canonical execution metadata', async () => {
    class FailingAdapter extends FakeAdapter {
      public override async *chat(): AsyncIterable<ChatChunk> {
        yield { delta: '' };
        throw new Error('adapter exploded');
      }
    }

    const registry = new ModelRegistry(
      {
        ...defaultConfig.models,
        'test-model': {
          adapter: 'fake',
          upstreamModel: 'fake-upstream',
        },
      },
      {
        ...defaultConfig.providers,
        fake: {
          type: 'codex',
          binary: 'fake',
          homePath: '~/.fake',
        },
      }
    );
    const useCase = new CompleteChatUseCase(registry, [new FailingAdapter()]);

    await expect(
      useCase.execute(
        {
          messages: [{ content: 'hi', role: 'user' }],
          model: 'test-model',
          stream: false,
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      canonicalModel: 'fake/fake-upstream',
      code: 'provider_request_failed',
      providerId: 'fake',
      requestedModel: 'test-model',
      statusCode: 502,
      type: 'provider_error',
    });
  });
});
