import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RotatingLogStream, createLogger } from '../src/logger.js';

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'catraquim-logger-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('RotatingLogStream', () => {
  it('rotates logs by size and keeps a bounded number of files', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'catraquim.log');
    const stream = new RotatingLogStream({
      filePath,
      maxBytes: 10,
      maxFiles: 2,
    });

    stream.write('123456789\n');
    stream.write('abcdefghij\n');
    stream.write('klmnopqrs\n');

    expect(readFileSync(filePath, 'utf8')).toBe('klmnopqrs\n');
    expect(readFileSync(`${filePath}.1`, 'utf8')).toBe('abcdefghij\n');
    expect(readFileSync(`${filePath}.2`, 'utf8')).toBe('123456789\n');
  });

  it('creates the log directory when it does not exist', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'nested', 'catraquim.log');
    const stream = new RotatingLogStream({
      filePath,
      maxBytes: 10,
    });

    stream.write('created\n');

    expect(readFileSync(filePath, 'utf8')).toBe('created\n');
  });

  it('deletes the previous log instead of retaining rotated files when maxFiles is zero', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'catraquim.log');
    const stream = new RotatingLogStream({
      filePath,
      maxBytes: 5,
      maxFiles: 0,
    });

    stream.write('first\n');
    stream.write('next\n');

    expect(readFileSync(filePath, 'utf8')).toBe('next\n');
    expect(existsSync(`${filePath}.1`)).toBe(false);
  });

  it('uses production env values for the log file and rotation limits', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'production.log');
    const logger = createLogger({
      CATRAQUIM_LOG_FILE: filePath,
      CATRAQUIM_LOG_MAX_BYTES: '1',
      CATRAQUIM_LOG_MAX_FILES: '0',
      NODE_ENV: 'production',
    });

    logger.info('first');
    logger.info('second');

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('"msg":"second"');
    expect(written).not.toContain('"msg":"first"');
    expect(existsSync(`${filePath}.1`)).toBe(false);
  });
});
