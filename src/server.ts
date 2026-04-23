import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { CodexAdapter } from './adapters/codex/index.js';
import { loadConfig } from './config/loader.js';
import type { AppConfig } from './config/schema.js';
import { AppError, toErrorResponse } from './errors.js';
import { logger } from './logger.js';
import { bearerAuth } from './middleware/auth.js';
import { createAdminRoutes } from './routes/admin.js';
import { createChatRoutes } from './routes/chat.js';
import { createModelsRoutes } from './routes/models.js';
import { ChatService } from './services/chat.js';
import { ServiceRouter } from './services/router.js';

export interface ServerContext {
  adapters: CodexAdapter[];
  chatService: ChatService;
  config: AppConfig;
}

export const createServerContext = (config = loadConfig()): ServerContext => {
  const adapters = [new CodexAdapter(config)];
  const router = new ServiceRouter(adapters);
  const chatService = new ChatService(router);

  return {
    adapters,
    chatService,
    config,
  };
};

export const createApp = (context = createServerContext()) => {
  const app = new Hono();

  app.use('*', bearerAuth(context.config.server.token));
  app.route('/', createAdminRoutes(context.config, context.adapters));
  app.route('/', createModelsRoutes(context.config));
  app.route('/', createChatRoutes(context.config, context.chatService));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      logger.warn({ err: error }, 'Request failed with application error');
    } else {
      logger.error({ err: error }, 'Request failed with unexpected error');
    }

    const mapped = toErrorResponse(error);
    return c.json(mapped.error, mapped.statusCode);
  });

  return app;
};

export const startServer = (config = loadConfig()) => {
  const app = createApp(createServerContext(config));

  logger.info(
    { host: config.server.host, port: config.server.port },
    'Starting catraquim'
  );

  return serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  });
};
