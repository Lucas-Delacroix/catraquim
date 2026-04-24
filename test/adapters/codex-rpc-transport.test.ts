import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareCodexHome } from '../../src/adapters/codex/auth-bridge.js';
import { CodexRpcTransport } from '../../src/adapters/codex/rpc-transport.js';
import { defaultConfig } from '../../src/config/defaults.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/adapters/codex/auth-bridge.js', () => ({
  prepareCodexHome: vi.fn(() => '/tmp/mock-codex-home'),
}));

class MockCodexProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 9999;
  public killed = false;

  private readonly rl: ReturnType<typeof createInterface>;
  private readonly messageHandlers: Array<
    (msg: Record<string, unknown>) => void
  > = [];

  constructor() {
    super();
    this.rl = createInterface({ input: this.stdin });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as Record<string, unknown>;
      for (const handler of [...this.messageHandlers]) {
        handler(msg);
      }
    });
  }

  public kill(_signal?: NodeJS.Signals) {
    this.killed = true;
    return true;
  }

  public onMessage(
    handler: (msg: Record<string, unknown>) => void
  ): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index !== -1) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  public respond(id: number, result: unknown) {
    this.stdout.push(`${JSON.stringify({ id, result })}\n`);
  }

  public respondError(id: number, code: number, message: string) {
    this.stdout.push(`${JSON.stringify({ error: { code, message }, id })}\n`);
  }

  public sendRequest(id: number, method: string, params?: unknown) {
    this.stdout.push(`${JSON.stringify({ id, method, params })}\n`);
  }

  public sendNotification(method: string, params?: unknown) {
    this.stdout.push(`${JSON.stringify({ method, params })}\n`);
  }
}

const mockSpawn = spawn as ReturnType<typeof vi.fn>;
const mockPrepareCodexHome = prepareCodexHome as ReturnType<typeof vi.fn>;

const createTransportPair = () => {
  const proc = new MockCodexProcess();
  mockSpawn.mockReturnValue(proc);
  mockPrepareCodexHome.mockReturnValue('/tmp/mock-codex-home');

  const transport = new CodexRpcTransport(defaultConfig.providers.codex);
  transport.start();

  return { proc, transport };
};

describe('CodexRpcTransport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects an in-flight request when the app-server exits mid-request', async () => {
    const { proc, transport } = createTransportPair();

    const requestPromise = transport.request('initialize', {
      capabilities: { experimentalApi: true },
    });

    proc.emit('exit', 1, 'SIGTERM');

    await expect(requestPromise).rejects.toMatchObject({
      code: 'app_server_exited',
      details: { code: 1, signal: 'SIGTERM' },
      statusCode: 502,
      type: 'transient_error',
    });
  });

  it('can restart cleanly after an unexpected process exit', async () => {
    const first = createTransportPair();

    const firstRequest = first.transport.request('initialize', {});
    first.proc.emit('exit', 1, null);
    await expect(firstRequest).rejects.toMatchObject({
      code: 'app_server_exited',
    });

    const secondProc = new MockCodexProcess();
    mockSpawn.mockReturnValueOnce(secondProc);

    first.transport.start();
    secondProc.onMessage((msg) => {
      if (msg.method === 'initialize') {
        secondProc.respond(msg.id as number, {
          userAgent: 'codex-mock/0.120.0',
        });
      }
    });

    await expect(first.transport.request('initialize', {})).resolves.toEqual({
      userAgent: 'codex-mock/0.120.0',
    });
  });

  it('supports aborting an in-flight request from a notification handler', async () => {
    const { proc, transport } = createTransportPair();

    proc.onMessage((msg) => {
      if (msg.method === 'initialize') {
        proc.respond(msg.id as number, { userAgent: 'codex-mock/0.120.0' });
      }
    });

    await transport.request('initialize', {});

    const controller = new AbortController();
    transport.onNotification((msg) => {
      if (msg.method === 'turn/delta') {
        controller.abort();
      }
    });

    const requestPromise = transport.request(
      'turn/start',
      { threadId: 'thread-1' },
      { signal: controller.signal }
    );

    proc.sendNotification('turn/delta', { delta: 'hello' });

    await expect(requestPromise).rejects.toMatchObject({
      code: 'rpc_aborted',
      message: 'Codex RPC aborted: turn/start',
      statusCode: 499,
      type: 'transient_error',
    });
  });

  it('rejects pending requests during shutdown instead of leaving them hanging', async () => {
    const { transport } = createTransportPair();

    const requestPromise = transport.request('initialize', {});
    transport.shutdown();

    await expect(requestPromise).rejects.toMatchObject({
      code: 'app_server_not_running',
      message: 'Codex app-server is not running',
      statusCode: 502,
      type: 'transient_error',
    });
  });

  it('rejects requests immediately when the signal is already aborted', async () => {
    const { transport } = createTransportPair();
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.request('initialize', {}, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'rpc_aborted',
      message: 'Codex RPC aborted: initialize',
      statusCode: 499,
      type: 'transient_error',
    });
  });

  it('fails fast when app-server stdio pipes are unavailable', () => {
    mockSpawn.mockReturnValue(new EventEmitter() as never);
    const transport = new CodexRpcTransport(defaultConfig.providers.codex);

    expect(() => transport.start()).toThrow(/stdio pipes are unavailable/);
  });

  it('rejects pending requests on process spawn errors with the right classification', async () => {
    const { proc, transport } = createTransportPair();

    const missingBinary = transport.request('initialize', {});
    proc.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(missingBinary).rejects.toMatchObject({
      code: 'binary_not_found',
      details: { binary: defaultConfig.providers.codex.binary },
      statusCode: 500,
      type: 'configuration_error',
    });

    const next = createTransportPair();
    const processError = next.transport.request('initialize', {});
    next.proc.emit(
      'error',
      Object.assign(new Error('busy'), { code: 'EPIPE' })
    );
    await expect(processError).rejects.toMatchObject({
      code: 'process_error',
      statusCode: 502,
      transient: true,
      type: 'transient_error',
    });
  });

  it('maps RPC error responses to provider errors', async () => {
    const { proc, transport } = createTransportPair();
    proc.onMessage((msg) => {
      if (msg.method === 'initialize') {
        proc.respondError(msg.id as number, -32000, 'rpc exploded');
      }
    });
    const requestPromise = transport.request('initialize', {});

    await expect(requestPromise).rejects.toMatchObject({
      code: 'rpc_error',
      details: { rpcCode: -32000 },
      statusCode: 502,
      type: 'provider_error',
    });
  });

  it('auto-responds to server requests and ignores invalid JSON lines', async () => {
    const { proc, transport } = createTransportPair();
    const seen: Array<Record<string, unknown>> = [];
    proc.onMessage((msg) => {
      seen.push(msg);
    });

    proc.stdout.push('not-json\n');
    proc.sendRequest(41, 'item/tool/call', {});
    proc.sendRequest(42, 'custom/method', {});

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen).toContainEqual({
      id: 41,
      result: { contentItems: [], success: false },
    });
    expect(seen).toContainEqual({
      id: 42,
      result: {},
    });

    transport.shutdown();
  });

  it('isolates notification handler failures from other subscribers', async () => {
    const { proc, transport } = createTransportPair();
    const received: string[] = [];

    transport.onNotification(() => {
      throw new Error('handler failed');
    });
    transport.onNotification((msg) => {
      received.push(msg.method);
    });

    proc.sendNotification('turn/completed', { threadId: 'thread-1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toEqual(['turn/completed']);
  });

  it('supports unsubscribing exit handlers before the process exits', async () => {
    const { proc, transport } = createTransportPair();
    const handler = vi.fn();

    const unsubscribe = transport.onExit(handler);
    unsubscribe();

    proc.emit('exit', 0, null);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).not.toHaveBeenCalled();
  });

  it('surfaces stdin write failures for requests and notifications', async () => {
    const { proc, transport } = createTransportPair();
    const writeSpy = vi
      .spyOn(proc.stdin, 'write')
      .mockImplementationOnce((_chunk, _encoding, callback) => {
        callback?.(new Error('request write failed'));
        return true;
      })
      .mockImplementationOnce((_chunk, _encoding, callback) => {
        callback?.(new Error('notify write failed'));
        return true;
      });

    await expect(transport.request('initialize', {})).rejects.toMatchObject({
      code: 'stdin_write_failed',
      statusCode: 502,
      type: 'transient_error',
    });

    transport.notify('initialized');
    expect(writeSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects requests when the transport has no running stdin stream', async () => {
    const transport = new CodexRpcTransport(defaultConfig.providers.codex);

    await expect(transport.request('initialize', {})).rejects.toMatchObject({
      code: 'app_server_not_running',
      statusCode: 502,
      type: 'transient_error',
    });
  });

  it('escalates to SIGKILL when shutdown cannot terminate the process group', async () => {
    vi.useFakeTimers();
    const { proc, transport } = createTransportPair();
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('group missing');
    });
    const killSpy = vi.spyOn(proc, 'kill').mockImplementation(() => true);
    Object.defineProperty(proc, 'killed', { value: false, writable: true });

    transport.shutdown();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');

    processKillSpy.mockRestore();
    vi.useRealTimers();
  });

  it('wires stderr listeners while the process is running', async () => {
    const { proc, transport } = createTransportPair();

    proc.stderr.push('stderr chunk');
    await new Promise((resolve) => setTimeout(resolve, 10));

    transport.shutdown();
  });
});
