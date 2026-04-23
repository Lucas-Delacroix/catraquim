import type { CodexProviderConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { CodexRpcTransport } from './rpc-transport.js';
import type { CodexRpcNotificationMessage } from './types.js';

// Minimum server version accepted: 0.118.0
// userAgent format from server: "<originator>/<semver>" e.g. "codex/0.120.1"
const MIN_SERVER_VERSION = [0, 118, 0] as const;

function parseVersion(userAgent: string): [number, number, number] | null {
  const m = /^[^/]+\/(\d+)\.(\d+)\.(\d+)/.exec(userAgent);
  if (!m) return null;
  return [
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10),
    Number.parseInt(m[3], 10),
  ];
}

function versionAtLeast(
  actual: [number, number, number],
  min: readonly [number, number, number]
): boolean {
  for (let i = 0; i < min.length; i++) {
    if (actual[i] > min[i]) return true;
    if (actual[i] < min[i]) return false;
  }
  return true;
}

export class CodexAppServerClient {
  private readonly transport: CodexRpcTransport;
  private initialized = false;
  private initializingPromise?: Promise<void>;

  public constructor(config: CodexProviderConfig) {
    this.transport = new CodexRpcTransport(config);
    this.transport.onExit(() => {
      this.initialized = false;
      this.initializingPromise = undefined;
    });
  }

  public onNotification(
    handler: (msg: CodexRpcNotificationMessage) => void
  ): () => void {
    return this.transport.onNotification(handler);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initializingPromise) {
      this.initializingPromise = this.runInitialize();
    }
    await this.initializingPromise;
  }

  private async runInitialize(): Promise<void> {
    this.transport.start();

    const result = (await this.transport.request('initialize', {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: 'catraquim',
        title: 'Catraquim Gateway',
        version: '0.1.0',
      },
    })) as { userAgent?: string } | undefined;

    const userAgent = result?.userAgent ?? '';
    const version = userAgent ? parseVersion(userAgent) : null;

    if (version && !versionAtLeast(version, MIN_SERVER_VERSION)) {
      throw AppError.compatibility(
        `Codex app-server version too old (${userAgent}); need >= ${MIN_SERVER_VERSION.join('.')}`,
        502,
        undefined,
        {
          code: 'app_server_version_too_old',
          details: {
            minimumVersion: MIN_SERVER_VERSION.join('.'),
            userAgent,
          },
        }
      );
    }

    logger.debug({ userAgent }, 'codex app-server initialized');

    this.transport.notify('initialized');
    this.initialized = true;
  }

  public async request(
    method: string,
    params?: unknown,
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<unknown> {
    await this.ensureInitialized();
    return this.transport.request(method, params, opts);
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    await this.ensureInitialized();
    this.transport.notify(method, params);
  }

  public shutdown(): void {
    this.transport.shutdown();
    this.initialized = false;
    this.initializingPromise = undefined;
  }
}
