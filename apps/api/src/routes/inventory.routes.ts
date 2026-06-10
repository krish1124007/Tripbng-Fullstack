import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CreateInventoryRequestSchema,
  INVENTORY_STATUS,
  InventoryCalendarQuerySchema,
  PaginationQuerySchema,
  TRAVEL_TYPE,
  UpdateInventoryRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { containsRegex, prefixRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Inventory } from '../models/Inventory.js';
import {
  cloneInventory,
  createInventory,
  serializeInventory,
  updateInventory,
} from '../services/inventory.service.js';
import { recordAudit } from '../services/audit.service.js';

export const inventoryRouter: RouterT = Router();

inventoryRouter.use(authenticate, requireAuth);

// Manage Inventory list query — the reference search fields.
const InventoryListQuerySchema = PaginationQuerySchema.extend({
  inventoryName: z.string().trim().optional(),
  inventoryCode: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  airline: z.string().trim().optional(),
  pnr: z.string().trim().optional(),
  supplierId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  travelType: z.enum(TRAVEL_TYPE).optional(),
  status: z.enum(INVENTORY_STATUS).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

inventoryRouter.get(
  '/',
  requirePermission('inventory:read'),
  validate(InventoryListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const {
        page,
        limit,
        q,
        inventoryName,
        inventoryCode,
        origin,
        destination,
        airline,
        pnr,
        supplierId,
        travelType,
        status,
        startDate,
        endDate,
      } = req.query as unknown as ReturnType<typeof InventoryListQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      {
        const re = containsRegex(q);
        const codeRe = prefixRegex(q ? q.toUpperCase() : null);
        if (re && codeRe) {
          filter.$or = [
            { inventoryName: re },
            { inventoryCode: re },
            { 'origin.code': codeRe },
            { 'destination.code': codeRe },
          ];
        }
      }
      if (inventoryName) filter.inventoryName = new RegExp(inventoryName, 'i');
      if (inventoryCode) filter.inventoryCode = new RegExp(inventoryCode, 'i');
      if (origin) filter['origin.code'] = new RegExp(`^${origin.toUpperCase()}`);
      if (destination) filter['destination.code'] = new RegExp(`^${destination.toUpperCase()}`);
      if (airline) filter['segments.airline.code'] = airline.toUpperCase();
      if (pnr) filter.airlinePnr = new RegExp(pnr, 'i');
      if (supplierId) filter.supplierId = new Types.ObjectId(supplierId);
      if (travelType) filter.travelType = travelType;
      if (status) filter.status = status;
      // Date range — keep inventories whose series window overlaps [startDate, endDate].
      if (startDate) filter.seriesEndDate = { $gte: startDate };
      if (endDate) filter.seriesStartDate = { $lte: endDate };
      const [items, total] = await Promise.all([
        Inventory.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Inventory.countDocuments(filter),
      ]);
      return ok(res, items.map(serializeInventory), {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.get(
  '/calendar',
  requirePermission('inventory:read'),
  validate(InventoryCalendarQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { from, to, origin, destination } = req.query as unknown as ReturnType<
        typeof InventoryCalendarQuerySchema.parse
      >;
      const filter: Record<string, unknown> = {
        tenantId: req.auth!.tenantId,
        seriesEndDate: { $gte: from },
        seriesStartDate: { $lte: to },
      };
      if (origin) filter['origin.code'] = origin;
      if (destination) filter['destination.code'] = destination;

      const items = await Inventory.find(filter);

      // Bucket inventories by date for the requested range. Each day in the window that's
      // within [seriesStartDate, seriesEndDate] AND a daysOfOperation match gets the inventory.
      const byDate = new Map<string, ReturnType<typeof shape>[]>();
      const shape = (i: (typeof items)[number]) => ({
        id: String(i._id),
        inventoryCode: i.inventoryCode,
        inventoryName: i.inventoryName,
        status: i.status,
        seatsRemaining: i.seatsRemaining,
        seatsPerDay: i.seatsPerDay,
        adultFarePaise: i.fare!.adultFare,
        origin: i.origin!.code,
        destination: i.destination!.code,
      });

      const start = new Date(from);
      const end = new Date(to);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        const dow = d.getDay();
        const matches = items.filter(
          (i) =>
            d >= i.seriesStartDate &&
            d <= i.seriesEndDate &&
            (i.daysOfOperation ?? []).includes(dow),
        );
        if (matches.length > 0) byDate.set(key, matches.map(shape));
      }

      const days = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, inventories]) => ({ date, inventories }));
      return ok(res, days);
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.get('/:id', requirePermission('inventory:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const inv = await Inventory.findOne({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!inv) throw new AppError('NOT_FOUND');
    return ok(res, serializeInventory(inv));
  } catch (err) {
    next(err);
  }
});

inventoryRouter.post(
  '/',
  requirePermission('inventory:create'),
  validate(CreateInventoryRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateInventoryRequestSchema.parse>;
      const inv = await createInventory(req.auth!.tenantId, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'inventory.create',
        resource: 'inventory',
        resourceId: String(inv._id),
        after: {
          name: inv.inventoryName,
          code: inv.inventoryCode,
          origin: inv.origin!.code,
          destination: inv.destination!.code,
        },
      });
      return created(res, serializeInventory(inv));
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.patch(
  '/:id',
  requirePermission('inventory:update'),
  validate(UpdateInventoryRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateInventoryRequestSchema.parse>;
      const before = await Inventory.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('NOT_FOUND');
      const inv = await updateInventory(req.params.id, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'inventory.update',
        resource: 'inventory',
        resourceId: req.params.id,
        before: { status: before.status, totalSeats: before.totalSeats },
        after: { status: inv.status, totalSeats: inv.totalSeats },
      });
      return ok(res, serializeInventory(inv));
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.post(
  '/:id/clone',
  requirePermission('inventory:create'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const inv = await cloneInventory(req.auth!.tenantId, req.params.id, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'inventory.clone',
        resource: 'inventory',
        resourceId: String(inv._id),
        after: { sourceId: req.params.id, code: inv.inventoryCode },
      });
      return created(res, serializeInventory(inv));
    } catch (err) {
      next(err);
    }
  },
);

inventoryRouter.post(
  '/:id/pause',
  requirePermission('inventory:update'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const inv = await Inventory.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      });
      if (!inv) throw new AppError('NOT_FOUND');
      const before = inv.status;
      inv.status = inv.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
      await inv.save();
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: inv.status === 'PAUSED' ? 'inventory.pause' : 'inventory.resume',
        resource: 'inventory',
        resourceId: req.params.id,
        before: { status: before },
        after: { status: inv.status },
      });
      return ok(res, serializeInventory(inv));
    } catch (err) {
      next(err);
    }
  },
);
