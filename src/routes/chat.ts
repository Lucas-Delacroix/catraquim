import { type OpenAPIHono, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';

import {
  generateChatCompletionId,
  toOpenAiChatCompletion,
  toOpenAiStreamChunk,
  toOpenAiStreamStartChunk,
} from '../sse/openai-stream.js';
import type { CompleteChatUseCase } from '../usecases/complete-chat.js';
import {
  createApiRoute,
  jsonErrorResponses,
  jsonRequestBody,
  jsonResponse,
} from './openapi.js';
import {
  type ChatMessageInput,
  chatCompletionRequestSchema,
  chatCompletionResponseSchema,
} from './schemas.js';

const chatCompletionJsonResponse = jsonResponse(
  chatCompletionResponseSchema,
  'Chat completion.'
);

const chatCompletionsRoute = createApiRoute({
  method: 'post',
  path: '/v1/chat/completions',
  request: jsonRequestBody(chatCompletionRequestSchema),
  responses: {
    200: {
      ...chatCompletionJsonResponse,
      content: {
        ...chatCompletionJsonResponse.content,
        'text/event-stream': {
          schema: z.string(),
        },
      },
    },
    ...jsonErrorResponses([400, 401, 404, 413, 500, 501, 502, 504]),
  },
  tag: 'Chat',
});

const formatToolCall = (
  toolCall: NonNullable<ChatMessageInput['tool_calls']>[number]
) => {
  const args = toolCall.function.arguments ?? '';
  return `[tool_call ${toolCall.id}: ${toolCall.function.name}(${args})]`;
};

const toInternalContent = (message: ChatMessageInput) => {
  if (message.content !== null && message.content !== undefined) {
    return message.content;
  }

  return message.tool_calls?.map(formatToolCall).join('\n') ?? '';
};

const toInternalChatMessage = (message: ChatMessageInput) => ({
  content: toInternalContent(message),
  role: message.role === 'developer' ? 'system' : message.role,
  ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
});

const toInternalStopSequences = (
  stop: string | string[] | null | undefined
) => {
  if (!stop) return undefined;
  return Array.isArray(stop) ? stop : [stop];
};

export const registerChatRoutes = (
  app: OpenAPIHono,
  completeChat: CompleteChatUseCase
) => {
  app.openapi(chatCompletionsRoute, async (c) => {
    const body = c.req.valid('json');
    const chatRequest = {
      frequencyPenalty: body.frequency_penalty,
      maxTokens: body.max_completion_tokens ?? body.max_tokens,
      messages: body.messages.map(toInternalChatMessage),
      model: body.model,
      presencePenalty: body.presence_penalty,
      reasoningEffort: body.reasoning_effort,
      responseFormat: body.response_format,
      stream: body.stream,
      stop: toInternalStopSequences(body.stop),
      temperature: body.temperature,
      toolChoice: body.tool_choice,
      topP: body.top_p,
      tools: body.tools,
      user: body.user,
    };

    if (body.stream) {
      const canonicalModel = completeChat.resolveModel(
        body.model
      ).canonicalModel;
      const id = generateChatCompletionId();

      return streamSSE(c, async (stream) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(toOpenAiStreamStartChunk(canonicalModel, id)),
          });

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

    return c.json(toOpenAiChatCompletion(result, generateChatCompletionId()));
  });
};
