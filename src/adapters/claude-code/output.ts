import type { Usage } from '../base.js';

export interface ClaudeCodeOutput {
  text: string;
  usage?: Usage;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const pickPositiveNumber = (
  record: Record<string, unknown>,
  key: string
): number | undefined => {
  const value = record[key];
  return typeof value === 'number' && value > 0 ? value : undefined;
};

const pickNonEmptyString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const readUsage = (record: Record<string, unknown>): Usage | undefined => {
  if (!isRecord(record.usage)) {
    return undefined;
  }

  const promptTokens = pickPositiveNumber(record.usage, 'input_tokens');
  const completionTokens = pickPositiveNumber(record.usage, 'output_tokens');
  const inferredTotalTokens =
    promptTokens === undefined && completionTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (completionTokens ?? 0);
  const totalTokens =
    pickPositiveNumber(record.usage, 'total_tokens') ?? inferredTotalTokens;

  if (totalTokens === undefined) {
    return undefined;
  }

  return {
    completionTokens,
    promptTokens,
    totalTokens,
  };
};

const readErrorMessage = (
  record: Record<string, unknown>
): string | undefined => {
  if (isRecord(record.error)) {
    return readErrorMessage(record.error);
  }

  return (
    pickNonEmptyString(record.message) ??
    pickNonEmptyString(record.error) ??
    (record.type === 'error' ? JSON.stringify(record) : undefined)
  );
};

export const parseClaudeCodeOutput = (raw: string): ClaudeCodeOutput => {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  let usage: Usage | undefined;
  let text = '';
  let errorMessage: string | undefined;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    usage = readUsage(parsed) ?? usage;
    errorMessage = readErrorMessage(parsed) ?? errorMessage;

    if (parsed.type === 'result' && typeof parsed.result === 'string') {
      text = parsed.result.trim();
      continue;
    }

    if (typeof parsed.result === 'string' && parsed.result.trim()) {
      text = parsed.result.trim();
    }
  }

  if (!text && errorMessage) {
    throw new Error(errorMessage);
  }

  return {
    text,
    usage,
  };
};
