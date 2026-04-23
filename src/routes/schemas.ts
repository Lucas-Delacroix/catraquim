import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z
  .object({
    error: z.object({
      message: z.string(),
      type: z.string(),
    }),
  })
  .openapi('ErrorResponse');
