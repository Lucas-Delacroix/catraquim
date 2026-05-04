import { type RouteConfig, createRoute } from '@hono/zod-openapi';
import type { ZodType } from 'zod';

import { errorResponseSchema } from './schemas.js';

const APPLICATION_JSON = 'application/json';

const errorResponseDescriptions = {
  400: 'Invalid request payload.',
  401: 'Unauthorized.',
  404: 'Not found.',
  413: 'Payload too large.',
  500: 'Internal server error.',
  501: 'Feature not implemented.',
  502: 'Provider request failed.',
  504: 'Provider request timed out.',
} as const;

type ErrorStatusCode = keyof typeof errorResponseDescriptions;
type ApiRouteConfig<P extends string> = Omit<RouteConfig, 'path' | 'tags'> & {
  path: P;
  tag: string;
};

export const jsonRequestBody = <TSchema extends ZodType>(
  schema: TSchema,
  required = true
) => ({
  body: {
    content: {
      [APPLICATION_JSON]: {
        schema,
      },
    },
    required,
  },
});

export const jsonResponse = <TSchema extends ZodType>(
  schema: TSchema,
  description: string
) => ({
  content: {
    [APPLICATION_JSON]: {
      schema,
    },
  },
  description,
});

export const jsonErrorResponses = (
  statuses: readonly ErrorStatusCode[]
): RouteConfig['responses'] => {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      jsonResponse(errorResponseSchema, errorResponseDescriptions[status]),
    ])
  ) as RouteConfig['responses'];
};

export const createApiRoute = <
  const P extends string,
  const TRoute extends ApiRouteConfig<P>,
>({
  tag,
  ...routeConfig
}: TRoute) => {
  return createRoute({
    ...routeConfig,
    tags: [tag],
  });
};
