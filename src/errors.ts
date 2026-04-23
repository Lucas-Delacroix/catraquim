export class AppError extends Error {
  public readonly cause?: unknown;
  public readonly statusCode: number;

  public constructor(message: string, statusCode = 500, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export const toErrorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        type: 'gateway_error',
      },
      statusCode: error.statusCode,
    };
  }

  return {
    error: {
      message: 'Internal server error',
      type: 'internal_error',
    },
    statusCode: 500,
  };
};
