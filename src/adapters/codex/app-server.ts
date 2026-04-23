import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import type { AppConfig } from '../../config/schema.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { prepareCodexHome } from './auth-bridge.js';
import type { CodexRpcRequest, CodexRpcResponse } from './types.js';

export class CodexAppServerClient {
  private nextId = 1;
  private processRef?: ChildProcessWithoutNullStreams;

  public constructor(private readonly config: AppConfig) {}

  public ensureStarted() {
    if (this.processRef && !this.processRef.killed) {
      return this.processRef;
    }

    const codexHome = prepareCodexHome();

    this.processRef = spawn(this.config.codex.binary, ['app-server'], {
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: '',
      },
      stdio: 'pipe',
    });

    this.processRef.once('exit', (code, signal) => {
      logger.warn({ code, signal }, 'Codex app-server exited');
      this.processRef = undefined;
    });

    this.processRef.stderr.on('data', (chunk) => {
      logger.debug(
        { chunk: chunk.toString('utf8') },
        'Codex app-server stderr'
      );
    });

    return this.processRef;
  }

  public async request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<CodexRpcResponse> {
    const processRef = this.ensureStarted();
    const payload: CodexRpcRequest = {
      id: this.nextId++,
      jsonrpc: '2.0',
      method,
      params,
    };

    return new Promise<CodexRpcResponse>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        const line = chunk.toString('utf8').trim();

        if (!line) {
          return;
        }

        try {
          const parsed = JSON.parse(line) as CodexRpcResponse;

          if (parsed.id !== payload.id) {
            return;
          }

          processRef.stdout.off('data', onData);
          resolve(parsed);
        } catch (error) {
          processRef.stdout.off('data', onData);
          reject(
            new AppError(
              'Failed to parse JSON-RPC response from Codex app-server',
              502,
              error
            )
          );
        }
      };

      processRef.stdout.on('data', onData);
      processRef.stdin.write(
        `${JSON.stringify(payload)}\n`,
        'utf8',
        (error) => {
          if (error) {
            processRef.stdout.off('data', onData);
            reject(
              new AppError(
                'Failed to write JSON-RPC request to Codex app-server',
                502,
                error
              )
            );
          }
        }
      );
    });
  }
}
