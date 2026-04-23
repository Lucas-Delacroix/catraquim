export type AppErrorType =
  | 'authentication_error'
  | 'compatibility_error'
  | 'configuration_error'
  | 'gateway_error'
  | 'provider_error'
  | 'transient_error';

export interface AppErrorMetadata {
  canonicalModel?: string;
  code?: string;
  details?: Record<string, unknown>;
  providerId?: string;
  requestedModel?: string;
  transient?: boolean;
  type?: AppErrorType;
}

interface ErrorFactoryDefaults {
  statusCode: number;
  transient?: boolean;
  type: AppErrorType;
}

interface ErrorResponseBody {
  canonical_model?: string;
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  provider?: string;
  requested_model?: string;
  transient: boolean;
  type: string;
}

const INTERNAL_ERROR_RESPONSE: ErrorResponseBody = {
  message: 'Internal server error',
  transient: false,
  type: 'internal_error',
};

const buildErrorResponseBody = (error: AppError): ErrorResponseBody => {
  return {
    ...(error.canonicalModel ? { canonical_model: error.canonicalModel } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
    message: error.message,
    ...(error.providerId ? { provider: error.providerId } : {}),
    ...(error.requestedModel ? { requested_model: error.requestedModel } : {}),
    transient: error.transient,
    type: error.type,
  };
};

export class AppError extends Error {
  public readonly cause?: unknown;
  public readonly canonicalModel?: string;
  public readonly code?: string;
  public readonly details?: Record<string, unknown>;
  public readonly providerId?: string;
  public readonly requestedModel?: string;
  public readonly statusCode: number;
  public readonly transient: boolean;
  public readonly type: AppErrorType;

  public constructor(
    message: string,
    statusCode = 500,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.cause = cause;
    this.canonicalModel = metadata.canonicalModel;
    this.code = metadata.code;
    this.details = metadata.details;
    this.providerId = metadata.providerId;
    this.requestedModel = metadata.requestedModel;
    this.transient = metadata.transient ?? false;
    this.type = metadata.type ?? 'gateway_error';
  }

  private static typed(
    message: string,
    statusCode: number,
    cause: unknown,
    metadata: AppErrorMetadata,
    defaults: ErrorFactoryDefaults
  ) {
    return new AppError(message, statusCode ?? defaults.statusCode, cause, {
      ...metadata,
      transient: metadata.transient ?? defaults.transient,
      type: defaults.type,
    });
  }

  public static authentication(
    message: string,
    statusCode = 401,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    return AppError.typed(message, statusCode, cause, metadata, {
      statusCode: 401,
      type: 'authentication_error',
    });
  }

  public static compatibility(
    message: string,
    statusCode = 400,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    return AppError.typed(message, statusCode, cause, metadata, {
      statusCode: 400,
      type: 'compatibility_error',
    });
  }

  public static configuration(
    message: string,
    statusCode = 500,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    return AppError.typed(message, statusCode, cause, metadata, {
      statusCode: 500,
      type: 'configuration_error',
    });
  }

  public static provider(
    message: string,
    statusCode = 502,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    return AppError.typed(message, statusCode, cause, metadata, {
      statusCode: 502,
      type: 'provider_error',
    });
  }

  public static transient(
    message: string,
    statusCode = 504,
    cause?: unknown,
    metadata: AppErrorMetadata = {}
  ) {
    return AppError.typed(message, statusCode, cause, metadata, {
      statusCode: 504,
      transient: true,
      type: 'transient_error',
    });
  }

  public static enrich(error: AppError, metadata: AppErrorMetadata = {}) {
    return new AppError(error.message, error.statusCode, error.cause, {
      canonicalModel: metadata.canonicalModel ?? error.canonicalModel,
      code: metadata.code ?? error.code,
      details: metadata.details ?? error.details,
      providerId: metadata.providerId ?? error.providerId,
      requestedModel: metadata.requestedModel ?? error.requestedModel,
      transient: metadata.transient ?? error.transient,
      type: metadata.type ?? error.type,
    });
  }
}

export const toErrorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      error: buildErrorResponseBody(error),
      statusCode: error.statusCode,
    };
  }

  return {
    error: INTERNAL_ERROR_RESPONSE,
    statusCode: 500,
  };
};
