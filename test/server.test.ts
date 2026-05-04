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
          canonical_ref: 'codex/gpt-5.4',
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
          canonical_ref: 'codex/gpt-5.4-mini',
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
    expect(body.paths['/v1/responses']).toBeDefined();
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

    const response = await app.request('/healthz', {
      headers: {
        'x-request-id': 'req_123',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req_123');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/healthz',
        requestId: 'req_123',
        status: 200,
      }),
      'HTTP request'
    );
  });

  it('generates a request id when the client does not provide one', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/healthz');
    const requestId = response.headers.get('x-request-id');

    expect(response.status).toBe(200);
    expect(requestId).toEqual(expect.any(String));
    expect(requestId).not.toHaveLength(0);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
      }),
      'HTTP request'
    );
  });

  it('adds baseline security headers to successful responses', async () => {
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=(), microphone=()'
    );
  });

  it('handles CORS preflight before bearer authentication when token protected', async () => {
    const app = createApp(
      createServerContext({
        ...defaultConfig,
        server: {
          ...defaultConfig.server,
          token: 'secret-token',
        },
      })
    );

    const response = await app.request('/v1/chat/completions', {
      headers: {
        'access-control-request-headers': 'authorization, content-type',
        'access-control-request-method': 'POST',
        origin: 'https://client.example',
      },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'GET, POST, OPTIONS'
    );
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'authorization, content-type'
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('');
  });

  it('does not enable browser CORS access when bearer auth is disabled', async () => {
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/v1/chat/completions', {
      headers: {
        'access-control-request-method': 'POST',
        origin: 'https://client.example',
      },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns structured error payloads with canonical model metadata', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex/does-not-exist',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'unknown_model',
        message: 'Unknown model: codex/does-not-exist',
        requested_model: 'codex/does-not-exist',
        transient: false,
        type: 'compatibility_error',
      },
    });
  });

  it('returns a fresh chat completion id for each non-streaming response', async () => {
    const context = createServerContext(defaultConfig);
    vi.spyOn(context.completeChat, 'execute').mockResolvedValue({
      canonicalModel: 'codex/gpt-5.4',
      content: 'hello',
      finishReason: 'stop',
      providerId: 'codex',
      requestedModel: 'codex-max',
    });
    const app = createApp(context);
    const request = {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    } as const;

    const firstResponse = await app.request('/v1/chat/completions', request);
    const secondResponse = await app.request('/v1/chat/completions', request);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.id).toMatch(/^chatcmpl_/);
    expect(secondBody.id).toMatch(/^chatcmpl_/);
    expect(firstBody.id).not.toBe('chatcmpl_stub');
    expect(secondBody.id).not.toBe(firstBody.id);
  });

  it('accepts Responses API string input and maps it to chat execution', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'Docker empacota aplicações em contêineres portáveis.',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
        usage: {
          completionTokens: 9,
          promptTokens: 12,
          totalTokens: 21,
        },
      });
    const app = createApp(context);

    const response = await app.request('/v1/responses', {
      body: JSON.stringify({
        input: 'Explique Docker em um parágrafo curto.',
        instructions: 'Responda em português.',
        max_output_tokens: 80,
        model: 'codex-max',
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 80,
        messages: [
          { content: 'Responda em português.', role: 'system' },
          {
            content: 'Explique Docker em um parágrafo curto.',
            role: 'user',
          },
        ],
        model: 'codex-max',
        stream: false,
      }),
      expect.any(Object)
    );

    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^resp_/),
        object: 'response',
        status: 'completed',
        model: 'codex/gpt-5.4',
        output_text: 'Docker empacota aplicações em contêineres portáveis.',
        usage: {
          input_tokens: 12,
          output_tokens: 9,
          total_tokens: 21,
        },
      })
    );
    expect(body.output[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^msg_/),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            annotations: [],
            text: 'Docker empacota aplicações em contêineres portáveis.',
            type: 'output_text',
          },
        ],
      })
    );
  });

  it('rejects Responses API streaming until response event streaming is implemented', async () => {
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/v1/responses', {
      body: JSON.stringify({
        input: 'hi',
        model: 'codex-max',
        stream: true,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: {
        code: 'responses_streaming_unsupported',
        message:
          'Responses streaming is not supported yet; send stream=false or use /v1/chat/completions.',
        transient: false,
        type: 'compatibility_error',
      },
    });
  });

  it('maps OpenAI tool_call_id message fields to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            content: 'tool result',
            role: 'tool',
            tool_call_id: 'call_123',
          },
        ],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content: 'tool result',
            role: 'tool',
            toolCallId: 'call_123',
          },
        ],
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI developer messages to internal system instructions', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          { content: 'Follow project conventions.', role: 'developer' },
          { content: 'hi', role: 'user' },
        ],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content: 'Follow project conventions.',
            role: 'system',
          },
          {
            content: 'hi',
            role: 'user',
          },
        ],
      }),
      expect.any(AbortSignal)
    );
  });

  it('starts streaming chat completions with an assistant role delta', async () => {
    const context = createServerContext(defaultConfig);
    vi.spyOn(context.completeChat, 'stream').mockImplementation(
      async function* () {
        yield {
          delta: 'hello',
          finishReason: 'stop',
        };
      }
    );
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: true,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const body = await response.text();
    const events = body
      .split('\n\n')
      .filter(Boolean)
      .map((event) => event.replace(/^data: /, ''));

    expect(response.status).toBe(200);
    expect(events).toHaveLength(3);
    expect(JSON.parse(events[0])).toEqual(
      expect.objectContaining({
        choices: [
          {
            delta: {
              role: 'assistant',
            },
            finish_reason: null,
            index: 0,
          },
        ],
        model: 'codex/gpt-5.4',
        object: 'chat.completion.chunk',
      })
    );
    expect(JSON.parse(events[1])).toEqual(
      expect.objectContaining({
        choices: [
          {
            delta: {
              content: 'hello',
            },
            finish_reason: 'stop',
            index: 0,
          },
        ],
      })
    );
    expect(events[2]).toBe('[DONE]');
  });

  it('accepts OpenAI assistant tool_calls with null content', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            content: null,
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"city":"Sao Paulo"}',
                  name: 'get_weather',
                },
                id: 'call_123',
                type: 'function',
              },
            ],
          },
          {
            content: '25 C',
            role: 'tool',
            tool_call_id: 'call_123',
          },
        ],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content: '[tool_call call_123: get_weather({"city":"Sao Paulo"})]',
            role: 'assistant',
          },
          {
            content: '25 C',
            role: 'tool',
            toolCallId: 'call_123',
          },
        ],
      }),
      expect.any(AbortSignal)
    );
  });

  it('accepts OpenAI assistant tool_calls with omitted content', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{}',
                  name: 'list_directory',
                },
                id: 'call_123',
                type: 'function',
              },
            ],
          },
          {
            content: 'src',
            role: 'tool',
            tool_call_id: 'call_123',
          },
        ],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            content: '[tool_call call_123: list_directory({})]',
            role: 'assistant',
          },
          {
            content: 'src',
            role: 'tool',
            toolCallId: 'call_123',
          },
        ],
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI max_completion_tokens to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        max_completion_tokens: 512,
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 512,
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI top_p to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: false,
        top_p: 0.8,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topP: 0.8,
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI penalty parameters to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        frequency_penalty: 0.25,
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        presence_penalty: -0.5,
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        frequencyPenalty: 0.25,
        presencePenalty: -0.5,
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI user to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: false,
        user: 'end-user-123',
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'end-user-123',
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI response_format to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: '{"answer":"hello"}',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const responseFormat = {
      json_schema: {
        name: 'answer',
        schema: {
          additionalProperties: false,
          properties: {
            answer: { type: 'string' },
          },
          required: ['answer'],
          type: 'object',
        },
        strict: true,
      },
      type: 'json_schema',
    };

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        response_format: responseFormat,
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat,
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI tool_choice to the internal chat request', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const toolChoice = {
      function: { name: 'list_directory' },
      type: 'function',
    };

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stream: false,
        tool_choice: toolChoice,
        tools: [
          {
            function: {
              name: 'list_directory',
              parameters: {
                properties: {
                  path: { type: 'string' },
                },
                required: ['path'],
                type: 'object',
              },
            },
            type: 'function',
          },
        ],
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice,
      }),
      expect.any(AbortSignal)
    );
  });

  it('maps OpenAI stop strings to internal stop sequences', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi
      .spyOn(context.completeChat, 'execute')
      .mockResolvedValue({
        canonicalModel: 'codex/gpt-5.4',
        content: 'hello',
        finishReason: 'stop',
        providerId: 'codex',
        requestedModel: 'codex-max',
      });
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        stop: '<END>',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stop: ['<END>'],
      }),
      expect.any(AbortSignal)
    );
  });

  it('rejects requests for multiple OpenAI chat choices', async () => {
    const context = createServerContext(defaultConfig);
    const executeSpy = vi.spyOn(context.completeChat, 'execute');
    const app = createApp(context);

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex-max',
        n: 2,
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        details: {
          issues: [
            {
              code: 'too_big',
              message: expect.stringContaining('<=1'),
              path: 'json.n',
            },
          ],
          target: 'json',
        },
        message: 'Invalid request payload',
        transient: false,
        type: 'compatibility_error',
      },
    });
  });

  it('includes the request id in application error logs', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const app = createApp(createServerContext(defaultConfig));

    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'codex/does-not-exist',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'err_123',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('err_123');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'unknown_model',
        requestId: 'err_123',
        requestedModel: 'codex/does-not-exist',
      }),
      'Request failed with application error'
    );
  });

  it('returns structured validation errors for invalid request payloads', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/v1/chat/completions', {
      body: JSON.stringify({
        messages: [],
        model: 'codex-max',
        stream: false,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        details: {
          issues: [
            {
              code: 'too_small',
              message: expect.stringContaining('expected array'),
              path: 'json.messages',
            },
          ],
          target: 'json',
        },
        message: 'Invalid request payload',
        transient: false,
        type: 'compatibility_error',
      },
    });
  });

  it('returns structured validation errors for malformed JSON payloads', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/v1/chat/completions', {
      body: '{"model":',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'bad_json_123',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('bad_json_123');
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Malformed JSON in request body',
        transient: false,
        type: 'compatibility_error',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'invalid_request',
        requestId: 'bad_json_123',
      }),
      'Request failed with application error'
    );
  });

  it('rejects oversized request payloads with a structured error', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/v1/chat/completions', {
      body: '{}',
      headers: {
        'content-length': String(10 * 1024 * 1024 + 1),
        'content-type': 'application/json',
        'x-request-id': 'large_body_123',
      },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(response.headers.get('x-request-id')).toBe('large_body_123');
    expect(await response.json()).toEqual({
      error: {
        code: 'payload_too_large',
        details: {
          max_bytes: 10 * 1024 * 1024,
        },
        message: 'Payload too large',
        transient: false,
        type: 'compatibility_error',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'payload_too_large',
        requestId: 'large_body_123',
      }),
      'Request failed with application error'
    );
  });

  it('returns structured authentication errors from middleware', async () => {
    const app = createApp(
      createServerContext({
        ...defaultConfig,
        server: {
          ...defaultConfig.server,
          token: 'secret-token',
        },
      })
    );
    const response = await app.request('/healthz');

    expect(response.status).toBe(401);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_bearer_token',
        message: 'Unauthorized',
        transient: false,
        type: 'authentication_error',
      },
    });
  });

  it('returns structured errors for unknown routes', async () => {
    const app = createApp(createServerContext(defaultConfig));
    const response = await app.request('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    expect(await response.json()).toEqual({
      error: {
        code: 'route_not_found',
        message: 'Route not found',
        transient: false,
        type: 'compatibility_error',
      },
    });
  });

  it('accepts bearer credentials with a case-insensitive scheme', async () => {
    const app = createApp(
      createServerContext({
        ...defaultConfig,
        server: {
          ...defaultConfig.server,
          token: 'secret-token',
        },
      })
    );
    const response = await app.request('/healthz', {
      headers: {
        authorization: 'bearer   secret-token',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      server: {
        host: defaultConfig.server.host,
        port: defaultConfig.server.port,
      },
    });
  });
});
