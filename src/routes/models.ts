import { Hono } from 'hono';

import type { AppConfig } from '../config/schema.js';

export const createModelsRoutes = (config: AppConfig) => {
  const app = new Hono();

  app.get('/v1/models', (c) => {
    return c.json({
      object: 'list',
      data: Object.entries(config.models).map(([id, definition]) => ({
        id,
        object: 'model',
        owned_by: definition.adapter,
      })),
    });
  });

  return app;
};
