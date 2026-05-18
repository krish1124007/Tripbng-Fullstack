import type { Response } from 'express';
import type { PaginationMeta } from '@tripbng/shared';

export function ok<T>(res: Response, data: T, meta?: Partial<PaginationMeta>, status = 200) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, undefined, 201);
}

export function noContent(res: Response) {
  return res.status(204).send();
}
