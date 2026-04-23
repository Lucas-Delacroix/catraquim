import type { OpenAPIHono } from '@hono/zod-openapi';

import type { Adapter } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { createApiRoute, jsonErrorResponses, jsonResponse } from './openapi.js';
import { authStatusResponseSchema, healthzResponseSchema } from './schemas.js';

const healthzRoute = createApiRoute({
  method: 'get',
  path: '/healthz',
  responses: {
    200: jsonResponse(healthzResponseSchema, 'Gateway liveness check.'),
  },
  tag: 'Admin',
});

const authStatusRoute = createApiRoute({
  method: 'get',
  path: '/auth/status',
  responses: {
    200: jsonResponse(
      authStatusResponseSchema,
      'Authentication status for configured adapters.'
    ),
    ...jsonErrorResponses([401]),
  },
  tag: 'Admin',
});

export const registerAdminRoutes = (
  app: OpenAPIHono,
  config: AppConfig,
  adapters: Adapter[]
) => {
  app.openapi(healthzRoute, (c) => {
    return c.json({
      ok: true,
      server: {
        host: config.server.host,
        port: config.server.port,
      },
    });
  });

  app.openapi(authStatusRoute, async (c) => {
    const statuses = await Promise.all(
      adapters.map(async (adapter) => {
        const { id: _id, ...status } = await adapter.status();
        return [adapter.id, status] as const;
      })
    );

    return c.json(Object.fromEntries(statuses));
  });
};
