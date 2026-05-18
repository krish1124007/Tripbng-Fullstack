import type { NextFunction, Request, Response } from 'express';
import { AppError, type Role } from '@tripbng/shared';
import { verifyAccessToken } from '../utils/jwt.js';
import { User } from '../models/User.js';
import { runWithTenant } from './tenant-context.js';

export interface AuthContext {
  userId: string;
  role: Role;
  agencyId: string | null;
  distributorId: string | null;
  tenantId: string;
  customPermissions: string[];
  deniedPermissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      id?: string;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new AppError('TOKEN_INVALID');
    const token = header.slice('Bearer '.length).trim();
    const decoded = verifyAccessToken(token);

    // Pull permissions + tenant from DB so suspensions / permission changes apply immediately.
    const user = await User.findById(decoded.sub).select(
      'tenantId role status agencyId distributorId customPermissions deniedPermissions',
    );
    if (!user) throw new AppError('TOKEN_INVALID');
    if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
    if (user.status === 'BLOCKED') throw new AppError('ACCOUNT_BLOCKED');

    req.auth = {
      userId: String(user._id),
      role: user.role as Role,
      agencyId: user.agencyId ? String(user.agencyId) : null,
      distributorId: user.distributorId ? String(user.distributorId) : null,
      tenantId: String(user.tenantId),
      customPermissions: user.customPermissions ?? [],
      deniedPermissions: user.deniedPermissions ?? [],
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new AppError('TOKEN_INVALID'));
  // Populate the AsyncLocalStorage tenant context so the Mongoose tenancy
  // guard can auto-scope every query made downstream of this point.
  // We `next()` from inside `storage.run()` so the context propagates to
  // all subsequent middleware + the route handler.
  return runWithTenant(req.auth.tenantId, async () => {
    next();
  });
}
