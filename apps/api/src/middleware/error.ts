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

  // Mongoose duplicate key. We try to surface the actual colliding field so
  // ops doesn't spend an hour wondering why a booking POST is throwing
  // EMAIL_TAKEN. When the offending key is an `email`/`mobile` we keep the
  // friendlier code; everything else falls back to a generic
  // DUPLICATE_KEY with the field name in `details.field`.
  if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
    const dupErr = err as {
      keyPattern?: Record<string, number>;
      keyValue?: Record<string, unknown>;
      message?: string;
    };
    const field =
      Object.keys(dupErr.keyPattern ?? {})[0] ?? Object.keys(dupErr.keyValue ?? {})[0];
    logger.warn(
      {
        reqId: (req as Request & { id?: string }).id,
        field,
        keyValue: dupErr.keyValue,
        message: dupErr.message,
      },
      'mongo duplicate key (E11000)',
    );
    if (field === 'email') {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_TAKEN', message: 'Email already in use' },
      });
    }
    if (field === 'mobile') {
      return res.status(409).json({
        success: false,
        error: { code: 'MOBILE_TAKEN', message: 'Mobile number already in use' },
      });
    }
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_KEY',
        message: `Duplicate value on field '${field ?? 'unknown'}'`,
        details: { field, keyValue: dupErr.keyValue },
      },
    });
  }

  logger.error({ err, reqId: (req as Request & { id?: string }).id }, 'unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: ERROR_CODES.INTERNAL_ERROR.message },
  });
}
