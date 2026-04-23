import type { MiddlewareHandler } from 'hono';

import { AppError } from '../errors.js';

export const bearerAuth = (token: string | null): MiddlewareHandler => {
  return async (c, next) => {
    if (!token) {
      await next();
      return;
    }

    const header = c.req.header('authorization');
    const expected = `Bearer ${token}`;

    if (header !== expected) {
      throw AppError.authentication('Unauthorized', 401, undefined, {
        code: 'invalid_bearer_token',
      });
    }

    await next();
  };
};
