import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { AppConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { prepareCodexHome } from './auth-bridge.js';
import {
  type CodexRpcNotificationMessage,
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
} from './types.js';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const SERVER_REQUEST_DEFAULTS: Record<string, unknown> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  // Grants no additional permissions for the duration of the turn
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'item/tool/call': { contentItems: [], success: false },
  'item/tool/requestUserInput': { answers: {} },
  'mcpServer/elicitation/request': { action: 'decline' },
};

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

function buildChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  clearEnv: string[]
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...overrides };

  for (const key of clearEnv) {
    Reflect.deleteProperty(env, key);
  }

  return env;
}

export class CodexAppServerClient {
  private nextId = 1;
  private proc?: ChildProcess;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers: Array<
    (msg: CodexRpcNotificationMessage) => void
  > = [];
  private initialized = false;
  private initializingPromise?: Promise<void>;

  public constructor(private readonly config: AppConfig) {}

  private spawnProcess() {
    if (this.proc && !this.proc.killed) return;

    const codexHome = prepareCodexHome(this.config.codex.codexHomeSource);
    const isWindows = process.platform === 'win32';

    const env = buildChildEnv(process.env, { CODEX_HOME: codexHome }, [
      'OPENAI_API_KEY',
    ]);

    this.proc = spawn(
      this.config.codex.binary,
      ['app-server', '--listen', 'stdio://'],
      {
        detached: !isWindows,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const stdin = this.proc.stdin;
    const stdout = this.proc.stdout;
    const stderr = this.proc.stderr;

    if (!stdin || !stdout || !stderr) {
      throw new AppError('Codex app-server stdio pipes are unavailable', 502);
    }

    stdin.on('error', (error) => {
      logger.warn({ error }, 'codex app-server stdin error');
    });

    const rl = createInterface({ input: stdout });
    rl.on('line', (line) => this.handleLine(line));

    stderr.on('data', (chunk: Buffer) => {
      logger.debug(
        { chunk: chunk.toString('utf8') },
        'codex app-server stderr'
      );
    });

    this.proc.once('exit', (code, signal) => {
      logger.warn({ code, signal }, 'codex app-server exited');

      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          new AppError(
            `Codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
            502
          )
        );
        this.pendingRequests.delete(id);
      }

      this.proc = undefined;
      this.initialized = false;
      this.initializingPromise = undefined;
    });
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      logger.warn({ line: trimmed }, 'Failed to parse codex message');
      return;
    }

    if (isRpcResponse(msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;

      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(
          new AppError(
            `Codex RPC error on request ${msg.id}: ${msg.error.message}`,
            502
          )
        );
      } else {
        pending.resolve(msg.result);
      }
    } else if (isRpcRequest(msg)) {
      this.handleServerRequest(msg.id, msg.method);
    } else if (isRpcNotification(msg)) {
      for (const handler of [...this.notificationHandlers]) {
        handler(msg);
      }
    }
  }

  private handleServerRequest(id: number, method: string) {
    const result = SERVER_REQUEST_DEFAULTS[method] ?? {};
    this.sendRaw(JSON.stringify({ id, result }));
  }

  private sendRaw(line: string) {
    this.proc?.stdin?.write(`${line}\n`, 'utf8', (error) => {
      if (error) {
        logger.warn({ error }, 'Failed to write to codex app-server stdin');
      }
    });
  }

  public onNotification(
    handler: (msg: CodexRpcNotificationMessage) => void
  ): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      this.notificationHandlers = this.notificationHandlers.filter(
        (h) => h !== handler
      );
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initializingPromise) {
      this.initializingPromise = this.runInitialize();
    }
    await this.initializingPromise;
  }

  private async runInitialize(): Promise<void> {
    this.spawnProcess();

    const result = (await this.rawRequest('initialize', {
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
      throw new AppError(
        `Codex app-server version too old (${userAgent}); need >= ${MIN_SERVER_VERSION.join('.')}`,
        502
      );
    }

    logger.debug({ userAgent }, 'codex app-server initialized');

    this.sendRaw(JSON.stringify({ method: 'initialized' }));
    this.initialized = true;
  }

  private rawRequest(
    method: string,
    params?: unknown,
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      if (opts?.signal?.aborted) {
        reject(new AppError(`Codex RPC aborted: ${method}`, 499));
        return;
      }

      const timer = opts?.timeoutMs
        ? setTimeout(() => {
            this.pendingRequests.delete(id);
            reject(new AppError(`Codex RPC timeout: ${method}`, 504));
          }, opts.timeoutMs)
        : undefined;

      this.pendingRequests.set(id, { reject, resolve, timer });

      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pendingRequests.has(id)) return;
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          reject(new AppError(`Codex RPC aborted: ${method}`, 499));
        },
        { once: true }
      );

      this.proc?.stdin?.write(`${payload}\n`, 'utf8', (error) => {
        if (error) {
          if (!this.pendingRequests.has(id)) return;
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          reject(
            new AppError(
              `Failed to write to Codex app-server stdin: ${method}`,
              502,
              error
            )
          );
        }
      });
    });
  }

  public async request(
    method: string,
    params?: unknown,
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<unknown> {
    await this.ensureInitialized();
    return this.rawRequest(method, params, opts);
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    await this.ensureInitialized();
    this.sendRaw(JSON.stringify({ method, params }));
  }

  public shutdown(): void {
    const proc = this.proc;
    if (!proc || proc.killed) return;

    const isWindows = process.platform === 'win32';

    // Drain and close streams before signalling
    proc.stdin?.end();
    proc.stdin?.destroy();
    proc.stdout?.destroy();
    proc.stderr?.destroy();

    let groupKilled = false;
    if (!isWindows && proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGTERM');
        groupKilled = true;
      } catch {
        // process group already gone
      }
    }
    if (!groupKilled) {
      proc.kill('SIGTERM');
    }

    // SIGKILL fallback after 1 s
    const timer = setTimeout(() => {
      if (proc.killed) return;
      if (!isWindows && proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
          return;
        } catch {
          // fall through
        }
      }
      proc.kill('SIGKILL');
    }, 1000);

    // Don't keep the Node.js process alive just for cleanup
    timer.unref();
  }
}
