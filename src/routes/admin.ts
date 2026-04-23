import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { Adapter } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';
import { errorResponseSchema } from './schemas.js';

const healthzResponseSchema = z
  .object({
    ok: z.boolean(),
    server: z.object({
      host: z.string(),
      port: z.number().int().positive(),
    }),
  })
  .openapi('HealthzResponse');

const authStatusEntrySchema = z
  .object({
    expiresAt: z.string().nullable().optional(),
    message: z.string().optional(),
    ok: z.boolean(),
  })
  .openapi('AdapterAuthStatus');

const authStatusResponseSchema = z
  .record(z.string(), authStatusEntrySchema)
  .openapi('AuthStatusResponse');

const healthzRoute = createRoute({
  method: 'get',
  path: '/healthz',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: healthzResponseSchema,
        },
      },
      description: 'Gateway liveness check.',
    },
  },
  tags: ['Admin'],
});

const authStatusRoute = createRoute({
  method: 'get',
  path: '/auth/status',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: authStatusResponseSchema,
        },
      },
      description: 'Authentication status for configured adapters.',
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
  tags: ['Admin'],
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
