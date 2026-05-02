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
  abortCleanup?: () => void;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface ProcessStreams {
  stderr: NonNullable<ChildProcess['stderr']>;
  stdin: NonNullable<ChildProcess['stdin']>;
  stdout: NonNullable<ChildProcess['stdout']>;
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
  private processCleanup?: () => void;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers: Array<
    (msg: CodexRpcNotificationMessage) => void
  > = [];

  public constructor(private readonly config: CodexProviderConfig) {}

  private isRunning() {
    return this.proc && !this.proc.killed;
  }

  private createProcessEnv() {
    const codexHome = prepareCodexHome(this.config.homePath);
    return buildChildEnv(process.env, { CODEX_HOME: codexHome }, [
      'OPENAI_API_KEY',
    ]);
  }

  private requireProcessStreams(proc: ChildProcess): ProcessStreams {
    const { stdin, stdout, stderr } = proc;

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

    return { stderr, stdin, stdout };
  }

  private completePendingRequest(id: number, error?: Error, result?: unknown) {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);
    pending.abortCleanup?.();

    if (error) {
      pending.reject(error);
      return;
    }

    pending.resolve(result);
  }

  private rejectAllPending(errorFactory: () => Error) {
    for (const id of [...this.pendingRequests.keys()]) {
      this.completePendingRequest(id, errorFactory());
    }
  }

  private rpcAbortError(method: string) {
    return AppError.transient(`Codex RPC aborted: ${method}`, 499, undefined, {
      code: 'rpc_aborted',
    });
  }

  private rpcTimeoutError(method: string) {
    return AppError.transient(`Codex RPC timeout: ${method}`, 504, undefined, {
      code: 'rpc_timeout',
    });
  }

  private stdinWriteError(method: string, error: Error) {
    return AppError.transient(
      `Failed to write to Codex app-server stdin: ${method}`,
      502,
      error,
      {
        code: 'stdin_write_failed',
      }
    );
  }

  private appServerNotRunningError() {
    return AppError.transient(
      'Codex app-server is not running',
      502,
      undefined,
      {
        code: 'app_server_not_running',
      }
    );
  }

  private processError(error: Error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
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
        });
  }

  private processExitError(code: number | null, signal: NodeJS.Signals | null) {
    return AppError.transient(
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
    );
  }

  private attachProcessListeners(streams: ProcessStreams) {
    const proc = this.proc;
    streams.stdin.on('error', (error) => {
      logger.warn({ error }, 'codex app-server stdin error');
    });

    const rl = createInterface({ input: streams.stdout });
    rl.on('line', (line) => this.handleLine(line));

    streams.stderr.on('data', (chunk: Buffer) => {
      logger.debug(
        { chunk: chunk.toString('utf8') },
        'codex app-server stderr'
      );
    });

    const handleError = (error: Error) => {
      logger.warn({ err: error }, 'codex app-server process error');
      this.rejectAllPending(() => this.processError(error));
    };

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      logger.warn({ code, signal }, 'codex app-server exited');
      this.rejectAllPending(() => this.processExitError(code, signal));
      rl.close();

      this.proc = undefined;
      this.processCleanup = undefined;
      for (const handler of [...this.exitHandlers]) {
        handler();
      }
    };

    proc?.once('error', handleError);
    proc?.once('exit', handleExit);

    this.processCleanup = () => {
      rl.close();
      streams.stdin.removeAllListeners('error');
      streams.stderr.removeAllListeners('data');
      proc?.removeListener('error', handleError);
      proc?.removeListener('exit', handleExit);
    };
  }

  public start(): void {
    if (this.isRunning()) return;

    const isWindows = process.platform === 'win32';

    this.proc = spawn(
      this.config.binary,
      ['app-server', '--listen', 'stdio://'],
      {
        detached: !isWindows,
        env: this.createProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    this.attachProcessListeners(this.requireProcessStreams(this.proc));
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

      if (msg.error) {
        this.completePendingRequest(
          msg.id,
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
        this.completePendingRequest(msg.id, undefined, msg.result);
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
        try {
          handler(msg);
        } catch (error) {
          logger.warn({ err: error }, 'Codex notification handler failed');
        }
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
        reject(this.rpcAbortError(method));
        return;
      }

      const timer = opts?.timeoutMs
        ? setTimeout(() => {
            this.completePendingRequest(id, this.rpcTimeoutError(method));
          }, opts.timeoutMs)
        : undefined;

      const abortHandler = () => {
        this.completePendingRequest(id, this.rpcAbortError(method));
      };

      opts?.signal?.addEventListener('abort', abortHandler, { once: true });

      this.pendingRequests.set(id, {
        abortCleanup: () =>
          opts?.signal?.removeEventListener('abort', abortHandler),
        reject,
        resolve,
        timer,
      });

      const stdin = this.proc?.stdin;
      if (!stdin) {
        this.completePendingRequest(id, this.appServerNotRunningError());
        return;
      }

      stdin.write(`${payload}\n`, 'utf8', (error) => {
        if (error) {
          this.completePendingRequest(id, this.stdinWriteError(method, error));
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

    this.rejectAllPending(() => this.appServerNotRunningError());
    this.processCleanup?.();
    this.processCleanup = undefined;

    const isWindows = process.platform === 'win32';
    proc.stdin?.end();
    proc.stdin?.destroy();
    proc.stdout?.destroy();
    proc.stderr?.destroy();

    const killGroup = (signal: NodeJS.Signals) => {
      if (isWindows || !proc.pid) return false;
      try {
        process.kill(-proc.pid, signal);
        return true;
      } catch {
        return false;
      }
    };

    if (!killGroup('SIGTERM')) {
      proc.kill('SIGTERM');
    }

    const timer = setTimeout(() => {
      if (proc.killed) return;
      if (!killGroup('SIGKILL')) {
        proc.kill('SIGKILL');
      }
    }, 1000);

    timer.unref();
  }
}
