import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { ChatMessage, ToolDefinition } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { AppError, toErrorResponse } from '../errors.js';
import type { ChatService } from '../services/chat.js';
import {
  createNotImplementedStreamPayload,
  toOpenAiChatCompletion,
} from '../sse/openai-stream.js';

const toolSchema = z.object({
  function: z.object({
    description: z.string().optional(),
    name: z.string(),
    parameters: z.record(z.unknown()).optional(),
  }),
  type: z.literal('function'),
});

const messageSchema = z.object({
  content: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  toolCallId: z.string().optional(),
});

const requestSchema = z.object({
  max_tokens: z.number().int().positive().optional(),
  messages: z.array(messageSchema).min(1),
  model: z.string().min(1),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.array(toolSchema).optional(),
});

const mapMessages = (
  messages: z.infer<typeof messageSchema>[]
): ChatMessage[] => messages;
const mapTools = (
  tools?: z.infer<typeof toolSchema>[]
): ToolDefinition[] | undefined => tools;

export const createChatRoutes = (
  _config: AppConfig,
  chatService: ChatService
) => {
  const app = new Hono();

  app.post(
    '/v1/chat/completions',
    zValidator('json', requestSchema),
    async (c) => {
      const body = c.req.valid('json');

      try {
        if (body.stream) {
          return c.json(createNotImplementedStreamPayload(body.model), 501);
        }

        const result = await chatService.complete(
          {
            maxTokens: body.max_tokens,
            messages: mapMessages(body.messages),
            model: body.model,
            stream: false,
            temperature: body.temperature,
            tools: mapTools(body.tools),
          },
          c.req.raw.signal
        );

        return c.json(toOpenAiChatCompletion(body.model, result));
      } catch (error) {
        const mapped = toErrorResponse(error);
        return c.json(mapped.error, mapped.statusCode);
      }
    }
  );

  app.onError((error, c) => {
    const mapped = toErrorResponse(error instanceof AppError ? error : error);
    return c.json(mapped.error, mapped.statusCode);
  });

  return app;
};
