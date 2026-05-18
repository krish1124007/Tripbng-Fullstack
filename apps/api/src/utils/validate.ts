import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '@tripbng/shared';

type ValidatedFields = 'body' | 'query' | 'params';

export function validate<S extends ZodTypeAny>(schema: S, field: ValidatedFields = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = schema.parse(req[field]) as z.infer<S>;
      // Mutate the source so downstream handlers see typed/coerced data
      (req as unknown as Record<string, unknown>)[field] = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new AppError('VALIDATION_ERROR', { issues: err.flatten() }));
      } else {
        next(err);
      }
    }
  };
}
