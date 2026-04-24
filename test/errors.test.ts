import { describe, expect, it } from 'vitest';

import { AppError, toErrorResponse } from '../src/errors.js';

describe('AppError', () => {
  it.each([
    [AppError.authentication, 401, 'authentication_error', false],
    [AppError.compatibility, 400, 'compatibility_error', false],
    [AppError.configuration, 500, 'configuration_error', false],
    [AppError.provider, 502, 'provider_error', false],
    [AppError.transient, 504, 'transient_error', true],
  ])(
    'applies factory defaults for %s',
    (factory, statusCode, type, transient) => {
      const cause = new Error('cause');
      const error = factory('boom', undefined, cause, {
        canonicalModel: 'codex/codex-max',
        code: 'example_code',
        details: { retry: false },
        providerId: 'codex',
        requestedModel: 'codex-max',
      });

      expect(error).toMatchObject({
        canonicalModel: 'codex/codex-max',
        cause,
        code: 'example_code',
        details: { retry: false },
        message: 'boom',
        name: 'AppError',
        providerId: 'codex',
        requestedModel: 'codex-max',
        statusCode,
        transient,
        type,
      });
    }
  );

  it('honors explicit status and transient overrides', () => {
    const error = AppError.transient('rate limited', 429, undefined, {
      transient: false,
    });

    expect(error.statusCode).toBe(429);
    expect(error.transient).toBe(false);
    expect(error.type).toBe('transient_error');
  });

  it('enriches metadata without losing existing fields', () => {
    const original = AppError.provider('failed', 503, new Error('upstream'), {
      code: 'provider_failed',
      providerId: 'codex',
    });

    const enriched = AppError.enrich(original, {
      canonicalModel: 'codex/codex-max',
      requestedModel: 'codex-max',
    });

    expect(enriched).toMatchObject({
      canonicalModel: 'codex/codex-max',
      code: 'provider_failed',
      message: 'failed',
      providerId: 'codex',
      requestedModel: 'codex-max',
      statusCode: 503,
      type: 'provider_error',
    });
    expect(enriched.cause).toBe(original.cause);
  });
});

describe('toErrorResponse', () => {
  it('serializes AppError metadata in the public error response shape', () => {
    expect(
      toErrorResponse(
        AppError.compatibility('unknown model', 404, undefined, {
          canonicalModel: 'codex/codex-max',
          code: 'unknown_model',
          details: { configured: false },
          providerId: 'codex',
          requestedModel: 'codex-max',
        })
      )
    ).toEqual({
      error: {
        canonical_model: 'codex/codex-max',
        code: 'unknown_model',
        details: { configured: false },
        message: 'unknown model',
        provider: 'codex',
        requested_model: 'codex-max',
        transient: false,
        type: 'compatibility_error',
      },
      statusCode: 404,
    });
  });

  it('hides unexpected errors behind a generic internal response', () => {
    expect(toErrorResponse(new Error('secret'))).toEqual({
      error: {
        message: 'Internal server error',
        transient: false,
        type: 'internal_error',
      },
      statusCode: 500,
    });
  });
});
