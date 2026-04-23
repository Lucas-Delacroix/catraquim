import { type RouteConfig, type ZodType, createRoute } from '@hono/zod-openapi';

import { errorResponseSchema } from './schemas.js';

const APPLICATION_JSON = 'application/json';

const errorResponseDescriptions = {
  400: 'Invalid request payload.',
  401: 'Unauthorized.',
  404: 'Not found.',
  500: 'Internal server error.',
  501: 'Feature not implemented.',
} as const;

type ErrorStatusCode = keyof typeof errorResponseDescriptions;
type ApiRouteConfig<P extends string> = Omit<RouteConfig, 'path' | 'tags'> & {
  path: P;
  tag: string;
};
export type CreatedApiRoute<P extends string> = RouteConfig & {
  path: P;
  tags: [string];
};

export const jsonRequestBody = (schema: ZodType, required = true) => ({
  body: {
    content: {
      [APPLICATION_JSON]: {
        schema,
      },
    },
    required,
  },
});

export const jsonResponse = (schema: ZodType, description: string) => ({
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

export const createApiRoute = <P extends string>({
  tag,
  ...routeConfig
}: ApiRouteConfig<P>): CreatedApiRoute<P> => {
  return createRoute({
    ...routeConfig,
    tags: [tag],
  }) as CreatedApiRoute<P>;
};
