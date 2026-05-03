import type { MiddlewareHandler } from 'hono';

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '600',
} as const;
const DEFAULT_ALLOWED_HEADERS = 'authorization, content-type, x-request-id';

export const tokenProtectedCors = (token: string | null): MiddlewareHandler => {
  return async (c, next) => {
    if (!token) {
      await next();
      return;
    }

    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      c.header(name, value);
    }
    c.header(
      'Access-Control-Allow-Headers',
      c.req.header('access-control-request-headers')?.trim() ||
        DEFAULT_ALLOWED_HEADERS
    );

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  };
};
