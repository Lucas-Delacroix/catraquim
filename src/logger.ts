import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';

import pino from 'pino';

const defaultLogMaxBytes = 10 * 1024 * 1024;
const defaultLogMaxFiles = 5;

type LoggerEnvironment = NodeJS.ProcessEnv;

export interface RotatingLogOptions {
  filePath: string;
  maxBytes?: number;
  maxFiles?: number;
}

export class RotatingLogStream extends Writable {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentBytes: number;

  public constructor(options: RotatingLogOptions) {
    super();
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes ?? defaultLogMaxBytes;
    this.maxFiles = options.maxFiles ?? defaultLogMaxFiles;
    this.currentBytes = this.readCurrentSize();

    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  public _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    try {
      const text = chunk.toString();
      const byteLength = Buffer.byteLength(text);

      if (
        this.currentBytes > 0 &&
        this.currentBytes + byteLength > this.maxBytes
      ) {
        this.rotate();
      }

      appendFileSync(this.filePath, text, 'utf8');
      this.currentBytes += byteLength;
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private readCurrentSize() {
    if (!existsSync(this.filePath)) {
      return 0;
    }

    return statSync(this.filePath).size;
  }

  private rotate() {
    if (this.maxFiles <= 0) {
      rmSync(this.filePath, { force: true });
      this.currentBytes = 0;
      return;
    }

    rmSync(this.rotatedFilePath(this.maxFiles), { force: true });

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source = this.rotatedFilePath(index);
      if (existsSync(source)) {
        renameSync(source, this.rotatedFilePath(index + 1));
      }
    }

    if (existsSync(this.filePath)) {
      renameSync(this.filePath, this.rotatedFilePath(1));
    }

    this.currentBytes = 0;
  }

  private rotatedFilePath(index: number) {
    return `${this.filePath}.${index}`;
  }
}

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInteger = (
  value: string | undefined,
  fallback: number
) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const defaultProductionLogFile = (env: LoggerEnvironment) => {
  const stateHome = env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateHome, 'catraquim', 'catraquim.log');
};

const createProductionLogStream = (env: LoggerEnvironment) =>
  new RotatingLogStream({
    filePath: env.CATRAQUIM_LOG_FILE ?? defaultProductionLogFile(env),
    maxBytes: parsePositiveInteger(
      env.CATRAQUIM_LOG_MAX_BYTES,
      defaultLogMaxBytes
    ),
    maxFiles: parseNonNegativeInteger(
      env.CATRAQUIM_LOG_MAX_FILES,
      defaultLogMaxFiles
    ),
  });

export const createLogger = (env: LoggerEnvironment = process.env) => {
  const isPrettyEnabled = env.NODE_ENV !== 'production';
  const options = {
    level: env.LOG_LEVEL ?? 'info',
    transport: isPrettyEnabled
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
  };

  if (isPrettyEnabled) {
    return pino(options);
  }

  return pino(options, createProductionLogStream(env));
};

export const logger = createLogger();
