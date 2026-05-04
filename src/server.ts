import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, ValidationTargets } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError, ZodIssue } from 'zod';

import packageJson from '../package.json' with { type: 'json' };
import type { Adapter } from './adapters/base.js';
import { ModelRegistry } from './application/model-registry.js';
import { ProviderFactory } from './application/provider-factory.js';
import { ProviderModelCatalog } from './application/provider-model-catalog.js';
import { loadConfig, resolvedConfigPaths } from './config/loader.js';
import type { AppConfig } from './config/schema.js';
import { AppError, toErrorResponse } from './errors.js';
import { logger } from './logger.js';
import { bearerAuth } from './middleware/auth.js';
import { tokenProtectedCors } from './middleware/cors.js';
import { securityHeaders } from './middleware/security.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerModelsRoutes } from './routes/models.js';
import { registerResponsesRoutes } from './routes/responses.js';
import { CompleteChatUseCase } from './usecases/complete-chat.js';
import { GetProviderStatusesUseCase } from './usecases/get-provider-statuses.js';
import { ListModelsUseCase } from './usecases/list-models.js';

export interface ServerContext {
  adapters: Adapter[];
  config: AppConfig;
  completeChat: CompleteChatUseCase;
  getProviderStatuses: GetProviderStatusesUseCase;
  listModels: ListModelsUseCase;
  providerModelCatalog: ProviderModelCatalog;
}

interface RequestLogContext {
  req: {
    header(name: string): string | undefined;
    method: string;
    path: string;
  };
  res: {
    status: number;
  };
}

interface RequestIdContext {
  get(key: 'requestId'): string | undefined;
  set(key: 'requestId', value: string): void;
}

type ValidationHookResult =
  | {
      data: unknown;
      success: true;
      target: keyof ValidationTargets;
    }
  | {
      error: ZodError;
      success: false;
      target: keyof ValidationTargets;
    };

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

const resolveRequestId = (header: string | undefined) => {
  if (!header) return randomUUID();

  const requestId = header.trim();
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : randomUUID();
};

const buildRequestLog = (
  c: RequestLogContext,
  startedAt: number,
  requestId: string
) => ({
  durationMs: Date.now() - startedAt,
  method: c.req.method,
  path: c.req.path,
  requestId,
  status: c.res.status,
});

const buildStartupModels = (config: AppConfig) => {
  return Object.entries(config.models).map(([alias, definition]) => ({
    alias,
    canonicalRef: `${definition.adapter}/${definition.upstreamModel}`,
  }));
};

const formatValidationPath = (
  target: keyof ValidationTargets,
  path: ZodIssue['path']
) => {
  const bodyPath = path.map(String).join('.');
  return bodyPath ? `${target}.${bodyPath}` : target;
};

const formatValidationIssues = (
  error: ZodError,
  target: keyof ValidationTargets
) =>
  error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: formatValidationPath(target, issue.path),
  }));

const validationErrorHook = (result: ValidationHookResult, _c: Context) => {
  if (result.success) return;

  throw AppError.compatibility('Invalid request payload', 400, result.error, {
    code: 'invalid_request',
    details: {
      issues: formatValidationIssues(result.error, result.target),
      target: result.target,
    },
  });
};

const logAppError = (error: AppError, requestId: string | undefined) => {
  logger.warn(
    {
      canonicalModel: error.canonicalModel,
      code: error.code,
      err: error,
      provider: error.providerId,
      requestId,
      requestedModel: error.requestedModel,
      transient: error.transient,
      type: error.type,
    },
    'Request failed with application error'
  );
};

const mapFrameworkError = (error: unknown) => {
  if (error instanceof HTTPException && error.status === 400) {
    return AppError.compatibility(
      error.message || 'Invalid request payload',
      400,
      error,
      { code: 'invalid_request' }
    );
  }

  return error;
};

const requestBodyLimit = () =>
  bodyLimit({
    maxSize: MAX_REQUEST_BODY_BYTES,
    onError: () => {
      throw AppError.compatibility('Payload too large', 413, undefined, {
        code: 'payload_too_large',
        details: {
          max_bytes: MAX_REQUEST_BODY_BYTES,
        },
      });
    },
  });

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

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const closeServer = (server: ServerType) =>
  new Promise<void>((resolve) => {
    server.close((error?: Error) => {
      if (error) {
        logger.error({ err: error }, 'HTTP server close failed');
        process.exitCode = 1;
      }
      resolve();
    });
  });

const registerShutdownHandlers = (server: ServerType, adapters: Adapter[]) => {
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let shuttingDown = false;

  const removeHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down catraquim');
    closeAdapters(adapters);
    await closeServer(server);
    removeHandlers();
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    const handler = () => {
      void shutdown(signal);
    };
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
    providerModelCatalog,
  };
};

const registerRequestLogging = (app: OpenAPIHono) => {
  app.use('*', async (c, next) => {
    const startedAt = Date.now();
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));

    c.header(REQUEST_ID_HEADER, requestId);
    (c as RequestIdContext).set('requestId', requestId);

    try {
      await next();
    } finally {
      logger.info(buildRequestLog(c, startedAt, requestId), 'HTTP request');
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
    const requestId = (c as RequestIdContext).get('requestId');
    const mappedError = mapFrameworkError(error);

    if (mappedError instanceof AppError) {
      logAppError(mappedError, requestId);
    } else {
      logger.error(
        { err: mappedError, requestId },
        'Request failed with unexpected error'
      );
    }

    const mapped = toErrorResponse(mappedError);
    return c.json(
      { error: mapped.error },
      mapped.statusCode as ContentfulStatusCode
    );
  });
};

const registerNotFoundHandler = (app: OpenAPIHono) => {
  app.notFound((c) => {
    const mapped = toErrorResponse(
      AppError.compatibility('Route not found', 404, undefined, {
        code: 'route_not_found',
      })
    );

    return c.json(
      { error: mapped.error },
      mapped.statusCode as ContentfulStatusCode
    );
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
  const app = new OpenAPIHono({ defaultHook: validationErrorHook });

  registerRequestLogging(app);
  app.use('*', securityHeaders());
  app.use('*', tokenProtectedCors(context.config.server.token));
  app.use('*', requestBodyLimit());
  app.use('*', bearerAuth(context.config.server.token));
  registerAdminRoutes(app, context.config, context.getProviderStatuses);
  registerModelsRoutes(app, context.listModels);
  registerChatRoutes(app, context.completeChat);
  registerResponsesRoutes(app, context.completeChat);
  registerApiDocs(app);
  registerNotFoundHandler(app);
  registerErrorHandler(app);

  return app;
};

const refreshModelCatalogInBackground = (context: ServerContext) => {
  context.providerModelCatalog.refresh(context.adapters).catch((error) => {
    logger.warn(
      { err: error },
      'Background model catalog refresh raised unexpectedly'
    );
  });
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

  refreshModelCatalogInBackground(context);
  registerShutdownHandlers(server, context.adapters);

  return server;
};
