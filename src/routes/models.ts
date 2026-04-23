import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppConfig } from '../config/schema.js';
import { errorResponseSchema } from './schemas.js';

const modelEntrySchema = z
  .object({
    id: z.string(),
    object: z.literal('model'),
    owned_by: z.string(),
  })
  .openapi('ModelEntry');

const modelsResponseSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(modelEntrySchema),
  })
  .openapi('ModelsResponse');

const modelsRoute = createRoute({
  method: 'get',
  path: '/v1/models',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: modelsResponseSchema,
        },
      },
      description: 'List configured models.',
    },
    401: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Unauthorized.',
    },
  },
  tags: ['Models'],
});

export const registerModelsRoutes = (app: OpenAPIHono, config: AppConfig) => {
  app.openapi(modelsRoute, (c) => {
    return c.json({
      object: 'list',
      data: Object.entries(config.models).map(([id, definition]) => ({
        id,
        object: 'model',
        owned_by: definition.adapter,
      })),
    });
  });
};
