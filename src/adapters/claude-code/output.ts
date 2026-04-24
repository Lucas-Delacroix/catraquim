import type { Usage } from '../base.js';

export interface ClaudeCodeOutput {
  sessionId?: string;
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

const readUsage = (record: Record<string, unknown>): Usage | undefined => {
  if (!isRecord(record.usage)) {
    return undefined;
  }

  const promptTokens = pickPositiveNumber(record.usage, 'input_tokens');
  const completionTokens = pickPositiveNumber(record.usage, 'output_tokens');
  const totalTokens =
    pickPositiveNumber(record.usage, 'total_tokens') ??
    (promptTokens || completionTokens
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);

  if (!promptTokens && !completionTokens && !totalTokens) {
    return undefined;
  }

  return {
    completionTokens,
    promptTokens,
    totalTokens,
  };
};

const pickSessionId = (record: Record<string, unknown>) => {
  for (const field of [
    'session_id',
    'sessionId',
    'conversation_id',
    'conversationId',
  ]) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const readErrorMessage = (
  record: Record<string, unknown>
): string | undefined => {
  if (isRecord(record.error)) {
    return readErrorMessage(record.error);
  }

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }

  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim();
  }

  if (record.type === 'error') {
    return JSON.stringify(record);
  }

  return undefined;
};

export const parseClaudeCodeOutput = (raw: string): ClaudeCodeOutput => {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  let sessionId: string | undefined;
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

    sessionId = pickSessionId(parsed) ?? sessionId;
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
    sessionId,
    text,
    usage,
  };
};
