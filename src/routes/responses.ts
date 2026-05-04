import { randomUUID } from 'node:crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';

import type { ChatMessage, ChatRequest, Usage } from '../adapters/base.js';
import { AppError } from '../errors.js';
import type { CompleteChatUseCase } from '../usecases/complete-chat.js';
import {
  createApiRoute,
  jsonErrorResponses,
  jsonRequestBody,
  jsonResponse,
} from './openapi.js';
import {
  type ResponseCreateRequestInput,
  responseCreateRequestSchema,
  responseCreateResponseSchema,
} from './schemas.js';

type ResponseInputMessage = Extract<
  ResponseCreateRequestInput['input'],
  unknown[]
>[number];

const responseJsonResponse = jsonResponse(
  responseCreateResponseSchema,
  'Model response.'
);

const responsesRoute = createApiRoute({
  method: 'post',
  path: '/v1/responses',
  request: jsonRequestBody(responseCreateRequestSchema),
  responses: {
    200: responseJsonResponse,
    ...jsonErrorResponses([400, 401, 404, 413, 500, 501, 502, 504]),
  },
  tag: 'Responses',
});

const generateResponseId = () => `resp_${randomUUID()}`;
const generateMessageId = () => `msg_${randomUUID()}`;

const toInternalRole = (
  role: ResponseInputMessage['role']
): ChatMessage['role'] => {
  if (role === 'developer') return 'system';
  return role;
};

const contentToText = (content: ResponseInputMessage['content']) => {
  if (typeof content === 'string') return content;
  return content.map((part) => part.text).join('\n');
};

const toInternalInputMessages = (
  input: ResponseCreateRequestInput['input']
): ChatMessage[] => {
  if (typeof input === 'string') {
    return [{ content: input, role: 'user' }];
  }

  return input.map((message) => ({
    content: contentToText(message.content),
    role: toInternalRole(message.role),
  }));
};

const toInternalStopSequences = (
  stop: string | string[] | null | undefined
) => {
  if (!stop) return undefined;
  return Array.isArray(stop) ? stop : [stop];
};

const toInternalChatRequest = (
  body: ResponseCreateRequestInput
): ChatRequest => {
  const messages: ChatMessage[] = [
    ...(body.instructions
      ? [{ content: body.instructions, role: 'system' as const }]
      : []),
    ...toInternalInputMessages(body.input),
  ];

  return {
    frequencyPenalty: body.frequency_penalty,
    maxTokens: body.max_output_tokens,
    messages,
    model: body.model,
    presencePenalty: body.presence_penalty,
    reasoningEffort: body.reasoning?.effort,
    responseFormat: body.text?.format,
    stream: false,
    stop: toInternalStopSequences(body.stop),
    temperature: body.temperature,
    topP: body.top_p,
    user: body.user,
  };
};

const toResponsesUsage = (usage: Usage | undefined) => {
  if (!usage) return undefined;

  return {
    input_tokens: usage.promptTokens,
    output_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  };
};

export const registerResponsesRoutes = (
  app: OpenAPIHono,
  completeChat: CompleteChatUseCase
) => {
  app.openapi(responsesRoute, async (c) => {
    const body = c.req.valid('json');

    if (body.stream) {
      throw AppError.compatibility(
        'Responses streaming is not supported yet; send stream=false or use /v1/chat/completions.',
        501,
        undefined,
        { code: 'responses_streaming_unsupported' }
      );
    }

    const result = await completeChat.execute(
      toInternalChatRequest(body),
      c.req.raw.signal
    );
    const createdAt = Math.floor(Date.now() / 1000);
    const outputText = {
      annotations: [],
      text: result.content,
      type: 'output_text' as const,
    };

    return c.json({
      id: generateResponseId(),
      object: 'response' as const,
      created_at: createdAt,
      completed_at: createdAt,
      status: 'completed' as const,
      model: result.canonicalModel,
      output: [
        {
          id: generateMessageId(),
          type: 'message' as const,
          status: 'completed' as const,
          role: 'assistant' as const,
          content: [outputText],
        },
      ],
      output_text: result.content,
      usage: toResponsesUsage(result.usage),
    });
  });
};
