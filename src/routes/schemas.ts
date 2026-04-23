import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z
  .object({
    error: z.object({
      message: z.string(),
      type: z.string(),
    }),
  })
  .openapi('ErrorResponse');

export const toolDefinitionSchema = z
  .object({
    function: z.object({
      description: z.string().optional(),
      name: z.string(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }),
    type: z.literal('function'),
  })
  .openapi('ToolDefinition');
export type ToolDefinitionInput = z.infer<typeof toolDefinitionSchema>;

export const chatMessageSchema = z
  .object({
    content: z.string(),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    toolCallId: z.string().optional(),
  })
  .openapi('ChatMessage');
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatCompletionRequestSchema = z
  .object({
    max_tokens: z.number().int().positive().optional(),
    messages: z.array(chatMessageSchema).min(1),
    model: z.string().min(1),
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
    server: z.object({
      host: z.string(),
      port: z.number().int().positive(),
    }),
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
