import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { AppConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { prepareCodexHome } from './auth-bridge.js';
import {
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
  type CodexRpcNotificationMessage,
} from './types.js';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const SERVER_REQUEST_DEFAULTS: Record<string, unknown> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { decision: 'decline' },
  'item/tool/call': { contentItems: [], success: false },
  'item/tool/requestUserInput': { answers: {} },
  'mcpServer/elicitation/request': { action: 'decline' },
};

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

    const codexHome = prepareCodexHome();
    const isWindows = process.platform === 'win32';

    this.proc = spawn(
      this.config.codex.binary,
      ['app-server', '--listen', 'stdio://'],
      {
        detached: !isWindows,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          OPENAI_API_KEY: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on('line', (line) => this.handleLine(line));

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      logger.debug({ chunk: chunk.toString('utf8') }, 'codex app-server stderr');
    });

    this.proc.once('exit', (code, signal) => {
      logger.warn({ code, signal }, 'codex app-server exited');

      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          new AppError('Codex app-server exited while waiting for response', 502)
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

    const result = await this.rawRequest('initialize', {
      capabilities: { experimentalApi: true },
      clientInfo: { name: 'catraquim', version: '0.1.0' },
    });

    logger.debug({ result }, 'codex app-server initialized');

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
}
