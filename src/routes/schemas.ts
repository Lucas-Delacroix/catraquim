import { z } from '@hono/zod-openapi';

const positiveInt = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const stopSchema = z
  .union([nonEmptyString, z.array(nonEmptyString).min(1).max(4), z.null()])
  .optional();

const responseFormatJsonSchema = z.object({
  description: z.string().optional(),
  name: nonEmptyString,
  schema: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

const responseFormatSchema = z.union([
  z.object({ type: z.literal('text') }),
  z.object({ type: z.literal('json_object') }),
  z.object({
    json_schema: responseFormatJsonSchema,
    type: z.literal('json_schema'),
  }),
]);

const toolFunctionSchema = z.object({
  description: z.string().optional(),
  name: nonEmptyString,
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const toolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  z.object({
    function: z.object({ name: nonEmptyString }),
    type: z.literal('function'),
  }),
]);

const toolCallFunctionSchema = z.object({
  arguments: z.string().optional(),
  name: nonEmptyString,
});

const toolCallSchema = z.object({
  function: toolCallFunctionSchema,
  id: nonEmptyString,
  type: z.literal('function'),
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
    content: z
      .union([z.string(), z.array(contentPartSchema), z.null()])
      .optional(),
    role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
    tool_calls: z.array(toolCallSchema).optional(),
    tool_call_id: z.string().optional(),
  })
  .superRefine((message, ctx) => {
    if (
      message.content === undefined &&
      !(
        message.role === 'assistant' &&
        message.tool_calls &&
        message.tool_calls.length > 0
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'content is required unless an assistant message includes tool_calls',
        path: ['content'],
      });
    }
  })
  .openapi('ChatMessage');
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatCompletionRequestSchema = z
  .object({
    frequency_penalty: z.number().min(-2).max(2).optional(),
    max_completion_tokens: positiveInt.optional(),
    max_tokens: positiveInt.optional(),
    messages: z.array(chatMessageSchema).min(1),
    model: nonEmptyString,
    n: positiveInt.max(1).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    reasoning_effort: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
    response_format: responseFormatSchema.optional(),
    stream: z.boolean().default(false),
    stop: stopSchema,
    temperature: z.number().min(0).max(2).optional(),
    tool_choice: toolChoiceSchema.optional(),
    top_p: z.number().min(0).max(1).optional(),
    tools: z.array(toolDefinitionSchema).optional(),
    user: z.string().optional(),
  })
  .openapi('ChatCompletionRequest');

export const usageSchema = z
  .object({
    completion_tokens: z.number().int().nonnegative().optional(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
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
