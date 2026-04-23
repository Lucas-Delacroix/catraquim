import type { MiddlewareHandler } from 'hono';

export const bearerAuth = (token: string | null): MiddlewareHandler => {
  return async (c, next) => {
    if (!token) {
      await next();
      return;
    }

    const header = c.req.header('authorization');
    const expected = `Bearer ${token}`;

    if (header !== expected) {
      return c.json(
        {
          error: {
            message: 'Unauthorized',
            type: 'authentication_error',
          },
        },
        401
      );
    }

    await next();
  };
};
