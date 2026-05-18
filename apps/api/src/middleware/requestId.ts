import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[a-zA-Z0-9_-]{6,64}$/.test(incoming) ? incoming : nanoid(16);
  (req as Request & { id: string }).id = id;
  res.setHeader('x-request-id', id);
  next();
}
