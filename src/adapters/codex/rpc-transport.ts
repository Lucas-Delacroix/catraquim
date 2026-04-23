import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { CodexProviderConfig } from '../../config/schema.js';
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
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const SERVER_REQUEST_DEFAULTS: Record<string, unknown> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'item/tool/call': { contentItems: [], success: false },
  'item/tool/requestUserInput': { answers: {} },
  'mcpServer/elicitation/request': { action: 'decline' },
};

const buildChildEnv = (
  baseEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  clearEnv: string[]
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...overrides };

  for (const key of clearEnv) {
    Reflect.deleteProperty(env, key);
  }

  return env;
};

export class CodexRpcTransport {
  private exitHandlers: Array<() => void> = [];
  private nextId = 1;
  private proc?: ChildProcess;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers: Array<
    (msg: CodexRpcNotificationMessage) => void
  > = [];

  public constructor(private readonly config: CodexProviderConfig) {}

  public start(): void {
    if (this.proc && !this.proc.killed) return;

    const codexHome = prepareCodexHome(this.config.homePath);
    const isWindows = process.platform === 'win32';
    const env = buildChildEnv(process.env, { CODEX_HOME: codexHome }, [
      'OPENAI_API_KEY',
    ]);

    this.proc = spawn(
      this.config.binary,
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
      throw AppError.provider(
        'Codex app-server stdio pipes are unavailable',
        502,
        undefined,
        {
          code: 'stdio_unavailable',
        }
      );
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

    this.proc.once('error', (error) => {
      logger.warn({ err: error }, 'codex app-server process error');

      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? AppError.configuration(
                `Codex binary not found: ${this.config.binary}`,
                500,
                error,
                {
                  code: 'binary_not_found',
                  details: {
                    binary: this.config.binary,
                  },
                }
              )
            : AppError.transient('Codex app-server process error', 502, error, {
                code: 'process_error',
              })
        );
        this.pendingRequests.delete(id);
      }
    });

    this.proc.once('exit', (code, signal) => {
      logger.warn({ code, signal }, 'codex app-server exited');

      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          AppError.transient(
            `Codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
            502,
            undefined,
            {
              code: 'app_server_exited',
              details: {
                code,
                signal,
              },
            }
          )
        );
        this.pendingRequests.delete(id);
      }

      this.proc = undefined;
      for (const handler of [...this.exitHandlers]) {
        handler();
      }
    });
  }

  public onExit(handler: () => void): () => void {
    this.exitHandlers.push(handler);
    return () => {
      this.exitHandlers = this.exitHandlers.filter(
        (candidate) => candidate !== handler
      );
    };
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
          AppError.provider(
            `Codex RPC error on request ${msg.id}: ${msg.error.message}`,
            502,
            msg.error,
            {
              code: 'rpc_error',
              details: {
                rpcCode: msg.error.code,
              },
            }
          )
        );
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (isRpcRequest(msg)) {
      const result = SERVER_REQUEST_DEFAULTS[msg.method] ?? {};
      this.sendRaw(JSON.stringify({ id: msg.id, result }));
      return;
    }

    if (isRpcNotification(msg)) {
      for (const handler of [...this.notificationHandlers]) {
        handler(msg);
      }
    }
  }

  public onNotification(
    handler: (msg: CodexRpcNotificationMessage) => void
  ): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      this.notificationHandlers = this.notificationHandlers.filter(
        (candidate) => candidate !== handler
      );
    };
  }

  public request(
    method: string,
    params?: unknown,
    opts?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      if (opts?.signal?.aborted) {
        reject(
          AppError.transient(`Codex RPC aborted: ${method}`, 499, undefined, {
            code: 'rpc_aborted',
          })
        );
        return;
      }

      const timer = opts?.timeoutMs
        ? setTimeout(() => {
            this.pendingRequests.delete(id);
            reject(
              AppError.transient(
                `Codex RPC timeout: ${method}`,
                504,
                undefined,
                {
                  code: 'rpc_timeout',
                }
              )
            );
          }, opts.timeoutMs)
        : undefined;

      this.pendingRequests.set(id, { reject, resolve, timer });

      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pendingRequests.has(id)) return;
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          reject(
            AppError.transient(`Codex RPC aborted: ${method}`, 499, undefined, {
              code: 'rpc_aborted',
            })
          );
        },
        { once: true }
      );

      this.proc?.stdin?.write(`${payload}\n`, 'utf8', (error) => {
        if (error) {
          if (!this.pendingRequests.has(id)) return;
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          reject(
            AppError.transient(
              `Failed to write to Codex app-server stdin: ${method}`,
              502,
              error,
              {
                code: 'stdin_write_failed',
              }
            )
          );
        }
      });
    });
  }

  public notify(method: string, params?: unknown): void {
    this.sendRaw(JSON.stringify({ method, params }));
  }

  private sendRaw(line: string) {
    this.proc?.stdin?.write(`${line}\n`, 'utf8', (error) => {
      if (error) {
        logger.warn({ error }, 'Failed to write to codex app-server stdin');
      }
    });
  }

  public shutdown(): void {
    const proc = this.proc;
    if (!proc || proc.killed) return;

    const isWindows = process.platform === 'win32';
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

    timer.unref();
  }
}
