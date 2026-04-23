import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import packageJson from '../package.json';
import type { Adapter } from './adapters/base.js';
import { CodexAdapter } from './adapters/codex/index.js';
import { loadConfig, resolvedConfigPaths } from './config/loader.js';
import type { AppConfig } from './config/schema.js';
import { AppError, toErrorResponse } from './errors.js';
import { logger } from './logger.js';
import { bearerAuth } from './middleware/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerModelsRoutes } from './routes/models.js';
import { ChatService } from './services/chat.js';
import { ServiceRouter } from './services/router.js';

export interface ServerContext {
  adapters: Adapter[];
  chatService: ChatService;
  config: AppConfig;
}

const closeAdapters = (adapters: Adapter[]) => {
  for (const adapter of adapters) {
    try {
      adapter.shutdown?.();
    } catch (error) {
      logger.warn(
        { err: error, adapter: adapter.id },
        'Adapter shutdown failed'
      );
    }
  }
};

const registerShutdownHandlers = (server: ServerType, adapters: Adapter[]) => {
  let shuttingDown = false;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  const removeHandlers = () => {
    for (const signal of signals) {
      const handler = signalHandlers.get(signal);
      if (handler) {
        process.removeListener(signal, handler);
      }
    }
  };

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down catraquim');
    closeAdapters(adapters);

    server.close((error?: Error) => {
      if (error) {
        logger.error({ err: error }, 'HTTP server close failed');
        process.exitCode = 1;
      }
      removeHandlers();
    });
  };

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = () => shutdown(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  server.once('close', removeHandlers);
};

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
  const app = new OpenAPIHono();

  app.use('*', async (c, next) => {
    const startedAt = Date.now();

    try {
      await next();
    } finally {
      logger.info(
        {
          durationMs: Date.now() - startedAt,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
        },
        'HTTP request'
      );
    }
  });

  app.use('*', bearerAuth(context.config.server.token));
  registerAdminRoutes(app, context.config, context.adapters);
  registerModelsRoutes(app, context.config);
  registerChatRoutes(app, context.config, context.chatService);

  app.doc('/openapi.json', {
    info: {
      title: 'catraquim',
      version: packageJson.version,
      description: packageJson.description,
    },
    openapi: '3.0.0',
    servers: [
      {
        url: '/',
      },
    ],
  });

  app.get(
    '/docs',
    swaggerUI({
      url: '/openapi.json',
    })
  );

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
  const context = createServerContext(config);
  const app = createApp(context);
  const configFiles = resolvedConfigPaths();

  logger.info(
    {
      configFiles,
      host: config.server.host,
      models: Object.keys(config.models),
      port: config.server.port,
    },
    'Starting catraquim'
  );

  const server = serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  });

  registerShutdownHandlers(server, context.adapters);

  return server;
};
