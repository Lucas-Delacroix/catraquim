import type { OpenAPIHono } from '@hono/zod-openapi';

import type { ListModelsUseCase } from '../usecases/list-models.js';
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

export const registerModelsRoutes = (
  app: OpenAPIHono,
  listModels: ListModelsUseCase
) => {
  app.openapi(modelsRoute, (c) => {
    return c.json({
      object: 'list',
      data: listModels.execute(),
    });
  });
};
