import type { ResolvedChatRequest } from '../base.js';
import { chatContentToText } from '../content.js';

const CLAUDE_MODEL_FAMILIES = ['haiku', 'opus', 'sonnet'] as const;

const toClaudeModelArg = (model: string) =>
  CLAUDE_MODEL_FAMILIES.find(
    (family) =>
      model === family ||
      model.startsWith(`${family}-`) ||
      model.startsWith(`claude-${family}-`)
  ) ?? model;

const splitMessages = (req: ResolvedChatRequest) => {
  const system = req.messages
    .filter((message) => message.role === 'system')
    .map((message) => chatContentToText(message.content))
    .join('\n\n')
    .trim();

  const prompt = req.messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role}: ${chatContentToText(message.content)}`)
    .join('\n')
    .trim();

  return {
    prompt:
      prompt ||
      req.messages
        .map((message) => chatContentToText(message.content))
        .join('\n'),
    system,
  };
};

export const toClaudeCodeRunArgs = (req: ResolvedChatRequest) => {
  const { prompt, system } = splitMessages(req);
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--no-session-persistence',
    '--setting-sources',
    'user',
    '--permission-mode',
    'bypassPermissions',
    '--model',
    toClaudeModelArg(req.upstreamModel),
  ];

  if (system) {
    args.push('--append-system-prompt', system);
  }

  if (req.reasoningEffort) {
    args.push('--effort', req.reasoningEffort);
  }

  return {
    args,
    prompt,
  };
};
