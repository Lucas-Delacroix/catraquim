import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import packageJson from '../package.json';
import type { Adapter } from './adapters/base.js';
import { ModelRegistry } from './application/model-registry.js';
import { ProviderFactory } from './application/provider-factory.js';
import { ProviderModelCatalog } from './application/provider-model-catalog.js';
import { loadConfig, resolvedConfigPaths } from './config/loader.js';
import type { AppConfig } from './config/schema.js';
import { AppError, toErrorResponse } from './errors.js';
import { logger } from './logger.js';
import { bearerAuth } from './middleware/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerModelsRoutes } from './routes/models.js';
import { CompleteChatUseCase } from './usecases/complete-chat.js';
import { GetProviderStatusesUseCase } from './usecases/get-provider-statuses.js';
import { ListModelsUseCase } from './usecases/list-models.js';

export interface ServerContext {
  adapters: Adapter[];
  config: AppConfig;
  completeChat: CompleteChatUseCase;
  getProviderStatuses: GetProviderStatusesUseCase;
  listModels: ListModelsUseCase;
}

interface RequestLogContext {
  req: {
    method: string;
    path: string;
  };
  res: {
    status: number;
  };
}

const buildRequestLog = (c: RequestLogContext, startedAt: number) => ({
  durationMs: Date.now() - startedAt,
  method: c.req.method,
  path: c.req.path,
  status: c.res.status,
});

const buildStartupModels = (config: AppConfig) => {
  return Object.entries(config.models).map(([alias, definition]) => ({
    alias,
    canonicalRef: `${definition.adapter}/${definition.upstreamModel}`,
  }));
};

const logAppError = (error: AppError) => {
  logger.warn(
    {
      canonicalModel: error.canonicalModel,
      code: error.code,
      err: error,
      provider: error.providerId,
      requestedModel: error.requestedModel,
      transient: error.transient,
      type: error.type,
    },
    'Request failed with application error'
  );
};

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

const createUseCases = (config: AppConfig, adapters: Adapter[]) => {
  const providerModelCatalog = new ProviderModelCatalog(config.providers);
  const modelRegistry = new ModelRegistry(
    config.models,
    config.providers,
    providerModelCatalog
  );

  return {
    completeChat: new CompleteChatUseCase(modelRegistry, adapters),
    getProviderStatuses: new GetProviderStatusesUseCase(adapters),
    listModels: new ListModelsUseCase(modelRegistry, providerModelCatalog),
  };
};

const registerRequestLogging = (app: OpenAPIHono) => {
  app.use('*', async (c, next) => {
    const startedAt = Date.now();

    try {
      await next();
    } finally {
      logger.info(buildRequestLog(c, startedAt), 'HTTP request');
    }
  });
};

const registerApiDocs = (app: OpenAPIHono) => {
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
};

const registerErrorHandler = (app: OpenAPIHono) => {
  app.onError((error, c) => {
    if (error instanceof AppError) {
      logAppError(error);
    } else {
      logger.error({ err: error }, 'Request failed with unexpected error');
    }

    const mapped = toErrorResponse(error);
    return c.json({ error: mapped.error }, mapped.statusCode);
  });
};

export const createServerContext = (config = loadConfig()): ServerContext => {
  const adapters = new ProviderFactory().create(config);
  const useCases = createUseCases(config, adapters);

  return {
    adapters,
    config,
    ...useCases,
  };
};

export const createApp = (context = createServerContext()) => {
  const app = new OpenAPIHono();

  registerRequestLogging(app);
  app.use('*', bearerAuth(context.config.server.token));
  registerAdminRoutes(app, context.config, context.getProviderStatuses);
  registerModelsRoutes(app, context.listModels);
  registerChatRoutes(app, context.completeChat);
  registerApiDocs(app);
  registerErrorHandler(app);

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
      models: buildStartupModels(config),
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
