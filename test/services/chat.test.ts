import { describe, expect, it } from 'vitest';

import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ChatRequest,
} from '../../src/adapters/base.js';
import { ChatService } from '../../src/services/chat.js';
import { ServiceRouter } from '../../src/services/router.js';

class FakeAdapter implements Adapter {
  public readonly id = 'fake';

  public supports(model: string): boolean {
    return model === 'test-model';
  }

  public async *chat(
    _req: ChatRequest,
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

describe('ChatService', () => {
  it('aggregates chunks for non-streaming responses', async () => {
    const router = new ServiceRouter([new FakeAdapter()]);
    const service = new ChatService(router);

    const result = await service.complete(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
        stream: false,
      },
      new AbortController().signal
    );

    expect(result.content).toBe('hello world');
    expect(result.finishReason).toBe('stop');
  });
});
