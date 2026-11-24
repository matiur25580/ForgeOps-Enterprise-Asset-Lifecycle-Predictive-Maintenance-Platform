import type { ErrorRequestHandler } from 'express';
import { env } from '../config/env.js';

// Keep internal exception details out of production responses while preserving conflict handling.
export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';

  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
    response.status(409).json({
      error: {
        code: 'RESOURCE_CONFLICT',
        message: 'A record with the same tenant-scoped unique identifier already exists.'
      }
    });
    return;
  }

  if (env.NODE_ENV !== 'production') {
    console.error(error);
  }

  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : message
    }
  });
};