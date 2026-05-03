import type { ChatRequest } from '../base.js';
import { chatContentToText } from '../content.js';

export interface ThreadStartParams {
  approvalPolicy: 'never';
  approvalsReviewer: 'user';
  cwd: string;
  experimentalRawEvents: boolean;
  model: string;
  modelProvider: 'openai';
  persistExtendedHistory: boolean;
  sandbox: 'workspace-write';
  serviceName: string;
}

export interface TurnBaseParams {
  approvalPolicy: 'never';
  approvalsReviewer: 'user';
  cwd: string;
  input: Array<{ text: string; type: 'text' }>;
  model: string;
}

export interface CodexRequestRuntime {
  cwd: string;
  serviceName: string;
}

const defaultRuntime = (): CodexRequestRuntime => ({
  cwd: process.cwd(),
  serviceName: 'catraquim',
});

export function toThreadStartParams(
  upstreamModel: string,
  runtime: CodexRequestRuntime = defaultRuntime()
): ThreadStartParams {
  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd: runtime.cwd,
    experimentalRawEvents: true,
    model: upstreamModel,
    modelProvider: 'openai',
    persistExtendedHistory: true,
    sandbox: 'workspace-write',
    serviceName: runtime.serviceName,
  };
}

export function toTurnBaseParams(
  req: ChatRequest,
  upstreamModel: string,
  runtime: CodexRequestRuntime = defaultRuntime()
): TurnBaseParams {
  const text = req.messages
    .map((message) => `${message.role}: ${chatContentToText(message.content)}`)
    .join('\n');

  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd: runtime.cwd,
    input: [{ text, type: 'text' }],
    model: upstreamModel,
  };
}
