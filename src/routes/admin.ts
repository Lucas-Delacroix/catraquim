import { Hono } from 'hono';

import type { Adapter } from '../adapters/base.js';
import type { AppConfig } from '../config/schema.js';

export const createAdminRoutes = (config: AppConfig, adapters: Adapter[]) => {
  const app = new Hono();

  app.get('/healthz', (c) => {
    return c.json({
      ok: true,
      server: {
        host: config.server.host,
        port: config.server.port,
      },
    });
  });

  app.get('/auth/status', async (c) => {
    const statuses = await Promise.all(
      adapters.map(async (adapter) => {
        const { id: _id, ...status } = await adapter.status();
        return [adapter.id, status] as const;
      })
    );

    return c.json(Object.fromEntries(statuses));
  });

  return app;
};
