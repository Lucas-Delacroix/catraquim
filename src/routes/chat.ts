import type { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';

import {
  toOpenAiChatCompletion,
  toOpenAiStreamChunk,
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

const generateCompletionId = () =>
  `chatcmpl_${Math.random().toString(36).slice(2, 11)}`;

export const registerChatRoutes = (
  app: OpenAPIHono,
  completeChat: CompleteChatUseCase
) => {
  app.openapi(chatCompletionsRoute, async (c) => {
    const body = c.req.valid('json');
    const chatRequest = {
      maxTokens: body.max_tokens,
      messages: body.messages,
      model: body.model,
      reasoningEffort: body.reasoning_effort,
      stream: body.stream,
      temperature: body.temperature,
      tools: body.tools,
    };

    if (body.stream) {
      const binding = completeChat.resolveModel(body.model);
      const canonicalModel = binding?.canonicalModel ?? body.model;
      const id = generateCompletionId();

      return streamSSE(c, async (stream) => {
        try {
          for await (const chunk of completeChat.stream(
            chatRequest,
            c.req.raw.signal
          )) {
            await stream.writeSSE({
              data: JSON.stringify(
                toOpenAiStreamChunk(chunk, canonicalModel, id)
              ),
            });
          }
        } finally {
          await stream.writeSSE({ data: '[DONE]' });
        }
      });
    }

    const result = await completeChat.execute(chatRequest, c.req.raw.signal);

    return c.json(toOpenAiChatCompletion(result));
  });
};
