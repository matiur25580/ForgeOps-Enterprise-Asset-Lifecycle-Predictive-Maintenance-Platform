import { Router, type Request, type Response, type NextFunction } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { AuditEvent } from '../models/audit-event.model.js';
import { User } from '../models/user.model.js';

export const auditEventsRouter = Router();
auditEventsRouter.use(authenticate);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  entityType: z.enum(['facility','asset','work_order','maintenance_plan','vendor','spare_part','stock_movement','purchase_requisition','purchase_order','goods_receipt','asset_alert','inspection','inspection_template','downtime_event','vendor_contract','team_member','team_invitation']).optional(),
  action: z.enum(['created','updated','archived','acknowledged','resolved']).optional(),
  actorUserId: z.string().optional(),
  facilityId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

function safeChanges(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toString();
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeChanges(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(password|token|secret|cookie|authorization|credential|privatekey)/i.test(key)) continue;
    if (key.startsWith('$') || key.includes('.')) continue;
    output[key] = safeChanges(child, depth + 1);
  }
  return output;
}

function forbidden(response: Response): void {
  response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Audit history is restricted to managers and administrators.' } });
}

auditEventsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claims = req.auth!;
    if (!['owner', 'admin', 'manager'].includes(claims.role)) {
      forbidden(res);
      return;
    }
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const query = parsed.data;
    const tenantId = new Types.ObjectId(claims.tenantId);
    const filter: Record<string, unknown> = { tenantId };
    if (query.entityType) filter.entityType = query.entityType;
    if (query.action) filter.action = query.action;

    if (query.actorUserId) {
      if (!Types.ObjectId.isValid(query.actorUserId)) {
        res.status(400).json({ error: { code: 'INVALID_ACTOR_ID' } });
        return;
      }
      filter.actorUserId = new Types.ObjectId(query.actorUserId);
    }
    if (query.facilityId) {
      if (!Types.ObjectId.isValid(query.facilityId)) {
        res.status(400).json({ error: { code: 'INVALID_FACILITY_ID' } });
        return;
      }
      filter.facilityId = new Types.ObjectId(query.facilityId);
    }
    if (claims.role === 'manager') {
      const assignedFacilities = claims.facilityIds.map((id) => new Types.ObjectId(id));
      const requestedFacility = query.facilityId ? new Types.ObjectId(query.facilityId) : undefined;
      if (requestedFacility && !assignedFacilities.some((id) => id.equals(requestedFacility))) {
        res.status(403).json({ error: { code: 'FACILITY_FORBIDDEN' } });
        return;
      }
      filter.facilityId = requestedFacility ? requestedFacility : { $in: assignedFacilities };
    }
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) {
        const from = new Date(query.from);
        if (Number.isNaN(from.getTime())) {
          res.status(400).json({ error: { code: 'INVALID_DATE_RANGE' } });
          return;
        }
        range.$gte = from;
      }
      if (query.to) {
        const to = new Date(query.to);
        if (Number.isNaN(to.getTime())) {
          res.status(400).json({ error: { code: 'INVALID_DATE_RANGE' } });
          return;
        }
        if (query.to.length === 10) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      if (range.$gte && range.$lte && range.$gte > range.$lte) {
        res.status(400).json({ error: { code: 'INVALID_DATE_RANGE' } });
        return;
      }
      filter.occurredAt = range;
    }

    const [events, total] = await Promise.all([
      AuditEvent.find(filter).sort({ occurredAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit).limit(query.limit)
        .select('_id tenantId actorUserId facilityId entityType entityId action changes occurredAt').lean(),
      AuditEvent.countDocuments(filter)
    ]);
    const actorIds = [...new Set(events.map((event) => event.actorUserId.toString()))]
      .map((id) => new Types.ObjectId(id));
    const actors = await User.find({ tenantId, _id: { $in: actorIds } })
      .select('_id firstName lastName email role').lean();
    const actorMap = new Map(actors.map((actor) => [actor._id.toString(), {
      id: actor._id.toString(),
      name: [actor.firstName, actor.lastName].filter(Boolean).join(' '),
      email: actor.email,
      role: actor.role
    }]));
    res.status(200).json({
      data: {
        events: events.map((event) => ({
          ...event,
          actor: actorMap.get(event.actorUserId.toString()) ?? {
            id: event.actorUserId.toString(), name: 'Former or unavailable user', role: 'unknown'
          },
          changes: safeChanges(event.changes)
        })),
        pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) }
      }
    });
  } catch (error) {
    next(error);
  }
});
