import type { ContentPart, ResolvedChatRequest } from '../base.js';

const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  'claude-haiku-3-5': 'haiku',
  'claude-haiku-4-5': 'haiku',
  'claude-opus-4': 'opus',
  'claude-opus-4-5': 'opus',
  'claude-opus-4-6': 'opus',
  'claude-opus-4-7': 'opus',
  'claude-sonnet-4-0': 'sonnet',
  'claude-sonnet-4-1': 'sonnet',
  'claude-sonnet-4-5': 'sonnet',
  'claude-sonnet-4-6': 'sonnet',
  'haiku-3.5': 'haiku',
  'opus-4': 'opus',
  'opus-4.5': 'opus',
  'opus-4.6': 'opus',
  'opus-4.7': 'opus',
  'sonnet-4.0': 'sonnet',
  'sonnet-4.1': 'sonnet',
  'sonnet-4.5': 'sonnet',
  'sonnet-4.6': 'sonnet',
};

const toClaudeModelArg = (model: string) =>
  CLAUDE_MODEL_ALIASES[model] ?? model;

const extractText = (content: string | ContentPart[]): string => {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter(
      (part): part is Extract<ContentPart, { type: 'text' }> =>
        part.type === 'text'
    )
    .map((part) => part.text)
    .join('');
};

const splitMessages = (req: ResolvedChatRequest) => {
  const system = req.messages
    .filter((message) => message.role === 'system')
    .map((message) => extractText(message.content))
    .join('\n\n')
    .trim();

  const prompt = req.messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role}: ${extractText(message.content)}`)
    .join('\n')
    .trim();

  return {
    prompt:
      prompt ||
      req.messages.map((message) => extractText(message.content)).join('\n'),
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
