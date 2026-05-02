import { z } from '@hono/zod-openapi';

const positiveInt = z.number().int().positive();
const nonEmptyString = z.string().min(1);

const toolFunctionSchema = z.object({
  description: z.string().optional(),
  name: nonEmptyString,
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string(),
});

const chatChoiceSchema = z.object({
  index: z.number().int(),
  finish_reason: z.string().nullable(),
  message: assistantMessageSchema,
});

const serverInfoSchema = z.object({
  host: z.string(),
  port: positiveInt,
});

export const errorResponseSchema = z
  .object({
    error: z.object({
      canonical_model: z.string().optional(),
      code: z.string().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
      message: z.string(),
      provider: z.string().optional(),
      requested_model: z.string().optional(),
      transient: z.boolean().optional(),
      type: z.string(),
    }),
  })
  .openapi('ErrorResponse');

export const toolDefinitionSchema = z
  .object({
    function: toolFunctionSchema,
    type: z.literal('function'),
  })
  .openapi('ToolDefinition');
export type ToolDefinitionInput = z.infer<typeof toolDefinitionSchema>;

const textContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imageContentPartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({ url: z.string() }),
});

const contentPartSchema = z.discriminatedUnion('type', [
  textContentPartSchema,
  imageContentPartSchema,
]);

export const chatMessageSchema = z
  .object({
    content: z.union([z.string(), z.array(contentPartSchema)]),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    toolCallId: z.string().optional(),
  })
  .openapi('ChatMessage');
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatCompletionRequestSchema = z
  .object({
    max_tokens: positiveInt.optional(),
    messages: z.array(chatMessageSchema).min(1),
    model: nonEmptyString,
    reasoning_effort: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(toolDefinitionSchema).optional(),
  })
  .openapi('ChatCompletionRequest');

export const usageSchema = z
  .object({
    completionTokens: z.number().int().nonnegative().optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .openapi('Usage');

export const chatCompletionResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal('chat.completion'),
    created: z.number().int(),
    model: z.string(),
    choices: z.array(chatChoiceSchema),
    usage: usageSchema.optional(),
  })
  .openapi('ChatCompletionResponse');

export const modelEntrySchema = z
  .object({
    canonical_ref: z.string(),
    id: z.string(),
    object: z.literal('model'),
    owned_by: z.string(),
    source: z.enum(['configured-alias', 'provider-catalog']),
  })
  .openapi('ModelEntry');

export const modelsResponseSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(modelEntrySchema),
  })
  .openapi('ModelsResponse');

export const healthzResponseSchema = z
  .object({
    ok: z.boolean(),
    server: serverInfoSchema,
  })
  .openapi('HealthzResponse');

export const adapterAuthStatusSchema = z
  .object({
    expiresAt: z.string().nullable().optional(),
    message: z.string().optional(),
    ok: z.boolean(),
  })
  .openapi('AdapterAuthStatus');

export const authStatusResponseSchema = z
  .record(z.string(), adapterAuthStatusSchema)
  .openapi('AuthStatusResponse');
