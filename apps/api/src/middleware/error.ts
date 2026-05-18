import type { NextFunction, Request, Response } from 'express';
import { AppError, ERROR_CODES } from '@tripbng/shared';
import { logger } from '../config/logger.js';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: ERROR_CODES.NOT_FOUND.message },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.http).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Mongoose duplicate key
  if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
    return res.status(409).json({
      success: false,
      error: { code: 'EMAIL_TAKEN', message: 'Resource already exists' },
    });
  }

  logger.error({ err, reqId: (req as Request & { id?: string }).id }, 'unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: ERROR_CODES.INTERNAL_ERROR.message },
  });
}
