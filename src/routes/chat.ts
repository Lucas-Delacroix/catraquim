import type { OpenAPIHono } from '@hono/zod-openapi';

import {
  createNotImplementedStreamPayload,
  toOpenAiChatCompletion,
} from '../sse/openai-stream.js';
import type { CompleteChatUseCase } from '../usecases/complete-chat.js';
import {
  createApiRoute,
  jsonErrorResponses,
  jsonRequestBody,
  jsonResponse,
} from './openapi.js';
import {
  chatCompletionRequestSchema,
  chatCompletionResponseSchema,
} from './schemas.js';

const chatCompletionsRoute = createApiRoute({
  method: 'post',
  path: '/v1/chat/completions',
  request: jsonRequestBody(chatCompletionRequestSchema),
  responses: {
    200: jsonResponse(
      chatCompletionResponseSchema,
      'Non-streaming chat completion.'
    ),
    ...jsonErrorResponses([400, 401, 404, 500, 501, 502, 504]),
  },
  tag: 'Chat',
});

export const registerChatRoutes = (
  app: OpenAPIHono,
  completeChat: CompleteChatUseCase
) => {
  app.openapi(chatCompletionsRoute, async (c) => {
    const body = c.req.valid('json');

    if (body.stream) {
      const binding = completeChat.resolveModel(body.model);
      return c.json(
        createNotImplementedStreamPayload(body.model, binding),
        501
      );
    }

    const result = await completeChat.execute(
      {
        maxTokens: body.max_tokens,
        messages: body.messages,
        model: body.model,
        stream: false,
        temperature: body.temperature,
        tools: body.tools,
      },
      c.req.raw.signal
    );

    return c.json(toOpenAiChatCompletion(result));
  });
};
