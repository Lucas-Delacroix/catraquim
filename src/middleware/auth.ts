import { createHash, timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { AppError } from '../errors.js';

const extractBearerToken = (header: string | undefined) => {
  if (!header) return null;

  const [scheme, ...tokenParts] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const providedToken = tokenParts.join(' ');
  return providedToken ? providedToken : null;
};

const hashSecret = (value: string) =>
  createHash('sha256').update(value).digest();

const secureTokenEquals = (provided: string, expectedDigest: Buffer) => {
  return timingSafeEqual(hashSecret(provided), expectedDigest);
};

export const bearerAuth = (token: string | null): MiddlewareHandler => {
  const expectedDigest = token ? hashSecret(token) : null;

  return async (c, next) => {
    if (!expectedDigest) {
      await next();
      return;
    }

    const providedToken = extractBearerToken(c.req.header('authorization'));

    if (!providedToken || !secureTokenEquals(providedToken, expectedDigest)) {
      throw AppError.authentication('Unauthorized', 401, undefined, {
        code: 'invalid_bearer_token',
      });
    }

    await next();
  };
};
