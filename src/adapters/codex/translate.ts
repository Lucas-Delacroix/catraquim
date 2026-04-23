import type { ChatRequest } from '../base.js';

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

export function toThreadStartParams(upstreamModel: string): ThreadStartParams {
  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd: process.cwd(),
    experimentalRawEvents: true,
    model: upstreamModel,
    modelProvider: 'openai',
    persistExtendedHistory: true,
    sandbox: 'workspace-write',
    serviceName: 'catraquim',
  };
}

export function toTurnBaseParams(
  req: ChatRequest,
  upstreamModel: string
): TurnBaseParams {
  const text = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  return {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    cwd: process.cwd(),
    input: [{ text, type: 'text' }],
    model: upstreamModel,
  };
}
