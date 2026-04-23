import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultConfig } from '../src/config/defaults.js';
import { logger } from '../src/logger.js';
import { createApp, createServerContext } from '../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAPI docs', () => {
  it('lists configured aliases and canonical provider/model refs', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/v1/models');

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual(
      expect.arrayContaining([
        {
          canonical_ref: 'codex/codex-max',
          id: 'codex-max',
          object: 'model',
          owned_by: 'codex',
          source: 'configured-alias',
        },
        {
          id: 'codex/codex-max',
          canonical_ref: 'codex/codex-max',
          object: 'model',
          owned_by: 'codex',
          source: 'provider-catalog',
        },
        {
          canonical_ref: 'codex/codex-mini',
          id: 'codex-mini',
          object: 'model',
          owned_by: 'codex',
          source: 'configured-alias',
        },
        {
          id: 'codex/codex-mini',
          canonical_ref: 'codex/codex-mini',
          object: 'model',
          owned_by: 'codex',
          source: 'provider-catalog',
        },
        {
          id: 'codex/gpt-5.4',
          canonical_ref: 'codex/gpt-5.4',
          object: 'model',
          owned_by: 'codex',
          source: 'provider-catalog',
        },
      ])
    );
  });

  it('serves the generated OpenAPI document', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/openapi.json');

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.info.title).toBe('catraquim');
    expect(body.servers).toEqual([{ url: '/' }]);
    expect(body.paths['/v1/chat/completions']).toBeDefined();
  });

  it('serves Swagger UI', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/docs');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('logs each HTTP request', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/healthz',
        status: 200,
      }),
      'HTTP request'
    );
  });
});
