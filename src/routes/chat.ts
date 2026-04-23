import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { ChatMessage, ToolDefinition } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { AppError, toErrorResponse } from '../errors.js';
import type { ChatService } from '../services/chat.js';
import {
  createNotImplementedStreamPayload,
  toOpenAiChatCompletion,
} from '../sse/openai-stream.js';
import { errorResponseSchema } from './schemas.js';

const toolSchema = z
  .object({
    function: z.object({
      description: z.string().optional(),
      name: z.string(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }),
    type: z.literal('function'),
  })
  .openapi('ToolDefinition');

const messageSchema = z
  .object({
    content: z.string(),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    toolCallId: z.string().optional(),
  })
  .openapi('ChatMessage');

const requestSchema = z
  .object({
    max_tokens: z.number().int().positive().optional(),
    messages: z.array(messageSchema).min(1),
    model: z.string().min(1),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(toolSchema).optional(),
  })
  .openapi('ChatCompletionRequest');

const usageSchema = z
  .object({
    completionTokens: z.number().int().nonnegative().optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .openapi('Usage');

const chatCompletionResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal('chat.completion'),
    created: z.number().int(),
    model: z.string(),
    choices: z.array(
      z.object({
        index: z.number().int(),
        finish_reason: z.string().nullable(),
        message: z.object({
          role: z.literal('assistant'),
          content: z.string(),
        }),
      })
    ),
    usage: usageSchema.optional(),
  })
  .openapi('ChatCompletionResponse');

const mapMessages = (
  messages: z.infer<typeof messageSchema>[]
): ChatMessage[] => messages;
const mapTools = (
  tools?: z.infer<typeof toolSchema>[]
): ToolDefinition[] | undefined => tools;

const chatCompletionsRoute = createRoute({
  method: 'post',
  path: '/v1/chat/completions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: requestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: chatCompletionResponseSchema,
        },
      },
      description: 'Non-streaming chat completion.',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Invalid request payload.',
    },
    401: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Unauthorized.',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Unknown model.',
    },
    500: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Internal server error.',
    },
    501: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Feature not implemented.',
    },
  },
  tags: ['Chat'],
});

export const registerChatRoutes = (
  app: OpenAPIHono,
  _config: AppConfig,
  chatService: ChatService
) => {
  app.openapi(chatCompletionsRoute, async (c) => {
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
  });
};
