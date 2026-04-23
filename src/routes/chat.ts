import type { OpenAPIHono } from '@hono/zod-openapi';

import type { ChatMessage, ToolDefinition } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { toErrorResponse } from '../errors.js';
import type { ChatService } from '../services/chat.js';
import {
  createNotImplementedStreamPayload,
  toOpenAiChatCompletion,
} from '../sse/openai-stream.js';
import {
  createApiRoute,
  jsonErrorResponses,
  jsonRequestBody,
  jsonResponse,
} from './openapi.js';
import {
  type ChatMessageInput,
  type ToolDefinitionInput,
  chatCompletionRequestSchema,
  chatCompletionResponseSchema,
} from './schemas.js';

const mapMessages = (messages: ChatMessageInput[]): ChatMessage[] => messages;
const mapTools = (
  tools?: ToolDefinitionInput[]
): ToolDefinition[] | undefined => tools;

const chatCompletionsRoute = createApiRoute({
  method: 'post',
  path: '/v1/chat/completions',
  request: jsonRequestBody(chatCompletionRequestSchema),
  responses: {
    200: jsonResponse(
      chatCompletionResponseSchema,
      'Non-streaming chat completion.'
    ),
    ...jsonErrorResponses([400, 401, 404, 500, 501]),
  },
  tag: 'Chat',
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
