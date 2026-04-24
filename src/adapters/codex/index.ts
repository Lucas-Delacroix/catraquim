import type { CodexProviderConfig } from '../../config/schema.js';
import { getCodexAuthStatus } from '../../credentials/codex.js';
import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ResolvedChatRequest,
} from '../base.js';
import { CodexAppServerClient } from './app-server.js';
import { listCodexModels } from './list-models.js';
import { runTurn } from './run-turn.js';
import { toThreadStartParams, toTurnBaseParams } from './translate.js';

export class CodexAdapter implements Adapter {
  private readonly rpcClient: CodexAppServerClient;

  public constructor(
    public readonly id: string,
    private readonly config: CodexProviderConfig
  ) {
    this.rpcClient = new CodexAppServerClient(config);
  }

  public async *chat(
    req: ResolvedChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const threadParams = toThreadStartParams(req.upstreamModel);
    const turnParams = toTurnBaseParams(req, req.upstreamModel);

    const result = await runTurn(
      this.rpcClient,
      threadParams as unknown as Record<string, unknown>,
      turnParams as unknown as Record<string, unknown>,
      signal
    );

    yield { delta: result.text, finishReason: 'stop' };
  }

  public listModels(signal?: AbortSignal): Promise<string[]> {
    return listCodexModels(this.rpcClient, { signal });
  }

  public async status(): Promise<AdapterStatus> {
    const auth = await getCodexAuthStatus(this.config.homePath);

    return {
      expiresAt: auth.expiresAt,
      id: this.id,
      message: auth.message,
      ok: auth.ok,
    };
  }

  public shutdown(): void {
    this.rpcClient.shutdown();
  }
}
