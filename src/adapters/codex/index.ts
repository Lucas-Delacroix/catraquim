import type { AppConfig } from '../../config/schema.js';
import { getCodexAuthStatus } from '../../credentials/codex.js';
import { AppError } from '../../errors.js';
import type {
  Adapter,
  AdapterStatus,
  ChatChunk,
  ChatRequest,
} from '../base.js';
import { CodexAppServerClient } from './app-server.js';
import { runTurn } from './run-turn.js';
import { toThreadStartParams, toTurnBaseParams } from './translate.js';

export class CodexAdapter implements Adapter {
  public readonly id = 'codex';
  private readonly rpcClient: CodexAppServerClient;

  public constructor(private readonly config: AppConfig) {
    this.rpcClient = new CodexAppServerClient(config);
  }

  public supports(model: string): boolean {
    return this.config.models[model]?.adapter === this.id;
  }

  public async *chat(
    req: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const modelConfig = this.config.models[req.model];
    if (!modelConfig) {
      throw new AppError(`Unknown model: ${req.model}`, 400);
    }

    const { upstreamModel } = modelConfig;
    const threadParams = toThreadStartParams(upstreamModel);
    const turnParams = toTurnBaseParams(req, upstreamModel);

    const result = await runTurn(
      this.rpcClient,
      threadParams as unknown as Record<string, unknown>,
      turnParams as unknown as Record<string, unknown>,
      signal
    );

    yield { delta: result.text, finishReason: 'stop' };
  }

  public async status(): Promise<AdapterStatus> {
    const auth = await getCodexAuthStatus(this.config.codex.codexHomeSource);

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
