import type { NextFunction, Request, Response } from 'express';
import { AppError, hasPermission, type Permission, type Role } from '@tripbng/shared';

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new AppError('TOKEN_INVALID'));
    const { role, customPermissions, deniedPermissions } = req.auth;
    const allowed = permissions.every((p) =>
      hasPermission(role, p, customPermissions, deniedPermissions),
    );
    if (!allowed) return next(new AppError('FORBIDDEN', { required: permissions }));
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new AppError('TOKEN_INVALID'));
    if (!roles.includes(req.auth.role)) return next(new AppError('FORBIDDEN'));
    next();
  };
}
