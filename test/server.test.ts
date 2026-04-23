import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config/defaults.js';
import { createApp, createServerContext } from '../src/server.js';

describe('OpenAPI docs', () => {
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
});
