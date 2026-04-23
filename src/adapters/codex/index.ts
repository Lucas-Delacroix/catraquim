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

export class CodexAdapter implements Adapter {
  public readonly id = 'codex';
  private readonly rpcClient: CodexAppServerClient;

  public constructor(private readonly config: AppConfig) {
    this.rpcClient = new CodexAppServerClient(config);
  }

  public supports(model: string): boolean {
    return this.config.models[model]?.adapter === this.id;
  }

  public chat(
    _req: ChatRequest,
    _signal: AbortSignal
  ): AsyncIterable<ChatChunk> {
    void this.rpcClient;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new AppError(
              'Codex chat adapter is not implemented yet',
              501
            );
          },
        };
      },
    };
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
}
