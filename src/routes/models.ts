import type { OpenAPIHono } from '@hono/zod-openapi';

import type { AppConfig } from '../config/schema.js';
import { createApiRoute, jsonErrorResponses, jsonResponse } from './openapi.js';
import { modelsResponseSchema } from './schemas.js';

const modelsRoute = createApiRoute({
  method: 'get',
  path: '/v1/models',
  responses: {
    200: jsonResponse(modelsResponseSchema, 'List configured models.'),
    ...jsonErrorResponses([401]),
  },
  tag: 'Models',
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
