import type { ClaudeCodeProviderConfig } from '../../config/schema.js';
import { getClaudeCodeAuthStatus } from '../../credentials/claude-code.js';
import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ResolvedChatRequest,
} from '../base.js';
import { runClaudeCode } from './run.js';

export class ClaudeCodeAdapter implements Adapter {
  public constructor(
    public readonly id: string,
    private readonly config: ClaudeCodeProviderConfig
  ) {}

  public async *chat(
    req: ResolvedChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const result = await runClaudeCode(this.config, req, signal);

    yield {
      delta: result.text,
      finishReason: 'stop',
      usage: result.usage,
    };
  }

  public async status(): Promise<AdapterStatus> {
    const auth = await getClaudeCodeAuthStatus(this.config.homePath);

    return {
      expiresAt: auth.expiresAt,
      id: this.id,
      message: auth.message,
      ok: auth.ok,
    };
  }
}
