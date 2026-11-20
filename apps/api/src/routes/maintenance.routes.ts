import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import type { WorkOrderRecord, WorkOrderStatus } from '../models/work-order.model.js';
import type { MaintenancePlanRecord } from '../models/maintenance-plan.model.js';
import { WorkOrder } from '../models/work-order.model.js';
import { MaintenancePlan } from '../models/maintenance-plan.model.js';
import { Asset } from '../models/asset.model.js';
import { Facility } from '../models/facility.model.js';
import { User } from '../models/user.model.js';
import { AuditEvent } from '../models/audit-event.model.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const maintenanceRouter = Router();
maintenanceRouter.use(authenticate);

const objectId = (value: string): boolean => Types.ObjectId.isValid(value);
const workOrderCreateSchema = z.object({
  facilityId: z.string().refine(objectId),
  assetId: z.string().refine(objectId),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  type: z.enum(['corrective', 'preventive', 'inspection']),
  priority: z.enum(['low', 'medium', 'high', 'emergency']).default('medium'),
  assignedTo: z.string().refine(objectId).optional(),
  scheduledStart: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  estimatedHours: z.number().finite().min(0).max(10000).optional()
}).strict();

const workOrderUpdateSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
  assignedTo: z.string().refine(objectId).nullable().optional(),
  scheduledStart: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  estimatedHours: z.number().finite().min(0).max(10000).optional(),
  actualHours: z.number().finite().min(0).max(10000).optional(),
  completionNotes: z.string().trim().max(4000).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.');

const planCreateSchema = z.object({
  facilityId: z.string().refine(objectId),
  assetId: z.string().refine(objectId),
  planCode: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  interval: z.number().int().min(1).max(365).default(1),
  nextDueAt: z.coerce.date(),
  estimatedHours: z.number().finite().min(0).max(10000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'emergency']).default('medium'),
  assignedTo: z.string().refine(objectId).optional()
}).strict();

const planUpdateSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  nextDueAt: z.coerce.date().optional(),
  estimatedHours: z.number().finite().min(0).max(10000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
  assignedTo: z.string().refine(objectId).nullable().optional(),
  active: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

function claimsFor(request: Request): AccessClaims { return request.auth!; }
function admin(claims: AccessClaims): boolean { return claims.role === 'owner' || claims.role === 'admin'; }
function manager(claims: AccessClaims): boolean { return admin(claims) || claims.role === 'manager'; }
function inScope(claims: AccessClaims, facilityId: string): boolean {
  return admin(claims) || claims.facilityIds.includes(facilityId);
}
function workOrderScope(claims: AccessClaims): FilterQuery<WorkOrderRecord> {
  const filter: FilterQuery<WorkOrderRecord> = { tenantId: new Types.ObjectId(claims.tenantId) };
  if (!admin(claims)) filter.facilityId = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
  if (claims.role === 'technician') filter.assignedTo = new Types.ObjectId(claims.sub);
  return filter;
}
async function validateAssignment(tenantId: string, facilityId: string, userId?: string): Promise<boolean> {
  if (!userId) return true;
  const user = await User.findOne({
    _id: userId, tenantId, status: 'active', role: 'technician', facilityIds: new Types.ObjectId(facilityId)
  }).select('_id');
  return Boolean(user);
}
function nextOccurrence(date: Date, frequency: MaintenancePlanRecord['frequency'], interval: number): Date {
  const next = new Date(date);
  if (frequency === 'daily') next.setUTCDate(next.getUTCDate() + interval);
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + interval * 7);
  if (frequency === 'monthly') next.setUTCMonth(next.getUTCMonth() + interval);
  if (frequency === 'quarterly') next.setUTCMonth(next.getUTCMonth() + interval * 3);
  if (frequency === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + interval);
  return next;
}

maintenanceRouter.get('/technicians', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const claims = claimsFor(request);
    const facilityId = typeof request.query.facilityId === 'string' ? request.query.facilityId : undefined;
    if (facilityId && (!objectId(facilityId) || !inScope(claims, facilityId))) {
      response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } }); return;
    }
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(claims.tenantId), role: 'technician', status: 'active'
    };
    if (facilityId) filter.facilityIds = new Types.ObjectId(facilityId);
    else if (!admin(claims)) filter.facilityIds = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
    const technicians = await User.find(filter).select('_id firstName lastName email facilityIds').sort({ firstName: 1, lastName: 1 }).lean();
    response.status(200).json({ data: { technicians } });
  } catch (error) { next(error); }
});

maintenanceRouter.get('/work-orders', async (request, response, next) => {
  try {
    const claims = claimsFor(request);
    const page = Math.max(1, Math.min(100000, Number(request.query.page) || 1));
    const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
    const filter = workOrderScope(claims);
    if (typeof request.query.status === 'string') filter.status = request.query.status as WorkOrderStatus;
    if (typeof request.query.priority === 'string') filter.priority = request.query.priority as WorkOrderRecord['priority'];
    if (typeof request.query.facilityId === 'string') {
      if (!objectId(request.query.facilityId) || !inScope(claims, request.query.facilityId)) {
        response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } }); return;
      }
      filter.facilityId = new Types.ObjectId(request.query.facilityId);
    }
    if (typeof request.query.assetId === 'string' && objectId(request.query.assetId)) filter.assetId = new Types.ObjectId(request.query.assetId);
    const [workOrders, total] = await Promise.all([
      WorkOrder.find(filter).populate('assetId', 'assetTag name criticality').populate('facilityId', 'code name')
        .populate('assignedTo', 'firstName lastName email').sort({ dueAt: 1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      WorkOrder.countDocuments(filter)
    ]);
    response.status(200).json({ data: { workOrders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
});

maintenanceRouter.post('/work-orders', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const parsed = workOrderCreateSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    const claims = claimsFor(request);
    if (!inScope(claims, parsed.data.facilityId)) { response.status(403).json({ error: { code: 'FACILITY_SCOPE_FORBIDDEN' } }); return; }
    const [facility, asset, assignedValid] = await Promise.all([
      Facility.findOne({ _id: parsed.data.facilityId, tenantId: claims.tenantId, status: 'active' }).select('_id'),
      Asset.findOne({ _id: parsed.data.assetId, tenantId: claims.tenantId, facilityId: parsed.data.facilityId, archivedAt: null }).select('_id'),
      validateAssignment(claims.tenantId, parsed.data.facilityId, parsed.data.assignedTo)
    ]);
    if (!facility) { response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } }); return; }
    if (!asset) { response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } }); return; }
    if (!assignedValid) { response.status(400).json({ error: { code: 'INVALID_TECHNICIAN_ASSIGNMENT' } }); return; }
    const workOrder = await WorkOrder.create({
      ...parsed.data,
      tenantId: new Types.ObjectId(claims.tenantId),
      facilityId: new Types.ObjectId(parsed.data.facilityId),
      assetId: new Types.ObjectId(parsed.data.assetId),
      assignedTo: parsed.data.assignedTo ? new Types.ObjectId(parsed.data.assignedTo) : undefined,
      workOrderNumber: `WO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      status: parsed.data.assignedTo ? 'assigned' : 'open',
      createdBy: new Types.ObjectId(claims.sub), updatedBy: new Types.ObjectId(claims.sub)
    });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId), actorUserId: new Types.ObjectId(claims.sub),
      facilityId: workOrder.facilityId, entityType: 'work_order', entityId: workOrder._id,
      action: 'created', changes: { fields: Object.keys(parsed.data) }
    });
    response.status(201).json({ data: { workOrder } });
  } catch (error) { next(error); }
});

maintenanceRouter.get('/work-orders/:workOrderId', async (request, response, next) => {
  try {
    const id = request.params.workOrderId;
    if (typeof id !== 'string' || !objectId(id)) { response.status(400).json({ error: { code: 'INVALID_WORK_ORDER_ID' } }); return; }
    const workOrder = await WorkOrder.findOne({ _id: id, ...workOrderScope(claimsFor(request)) })
      .populate('assetId', 'assetTag name criticality').populate('facilityId', 'code name')
      .populate('assignedTo', 'firstName lastName email').lean();
    if (!workOrder) { response.status(404).json({ error: { code: 'WORK_ORDER_NOT_FOUND' } }); return; }
    response.status(200).json({ data: { workOrder } });
  } catch (error) { next(error); }
});

maintenanceRouter.patch('/work-orders/:workOrderId', async (request, response, next) => {
  try {
    const id = request.params.workOrderId;
    if (typeof id !== 'string' || !objectId(id)) { response.status(400).json({ error: { code: 'INVALID_WORK_ORDER_ID' } }); return; }
    const parsed = workOrderUpdateSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    const claims = claimsFor(request);
    const current = await WorkOrder.findOne({ _id: id, ...workOrderScope(claims) });
    if (!current) { response.status(404).json({ error: { code: 'WORK_ORDER_NOT_FOUND' } }); return; }
    const technicianSelf = claims.role === 'technician' && current.assignedTo?.toString() === claims.sub;
    if (!manager(claims) && !technicianSelf) { response.status(403).json({ error: { code: 'FORBIDDEN' } }); return; }
    if (claims.role === 'technician' && Object.keys(parsed.data).some((key) => !['status', 'actualHours', 'completionNotes'].includes(key))) {
      response.status(403).json({ error: { code: 'TECHNICIAN_UPDATE_RESTRICTED' } }); return;
    }
    const transitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
      open: ['assigned', 'cancelled'], assigned: ['open', 'in_progress', 'cancelled'],
      in_progress: ['on_hold', 'completed', 'cancelled'], on_hold: ['in_progress', 'cancelled'],
      completed: [], cancelled: []
    };
    if (parsed.data.status && parsed.data.status !== current.status && !transitions[current.status].includes(parsed.data.status)) {
      response.status(409).json({ error: { code: 'INVALID_STATUS_TRANSITION', message: `Cannot move work order from ${current.status} to ${parsed.data.status}.` } }); return;
    }
    if (parsed.data.assignedTo && !await validateAssignment(claims.tenantId, current.facilityId.toString(), parsed.data.assignedTo)) {
      response.status(400).json({ error: { code: 'INVALID_TECHNICIAN_ASSIGNMENT' } }); return;
    }
    const update: Record<string, unknown> = { ...parsed.data, updatedBy: new Types.ObjectId(claims.sub) };
    if (parsed.data.assignedTo === null) { update.assignedTo = undefined; if (!parsed.data.status) update.status = 'open'; }
    else if (parsed.data.assignedTo) { update.assignedTo = new Types.ObjectId(parsed.data.assignedTo); if (!parsed.data.status && current.status === 'open') update.status = 'assigned'; }
    if (parsed.data.status === 'completed') update.completedAt = new Date();
    const workOrder = await WorkOrder.findOneAndUpdate({ _id: current._id, tenantId: claims.tenantId }, { $set: update }, { new: true, runValidators: true });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId), actorUserId: new Types.ObjectId(claims.sub),
      facilityId: current.facilityId, entityType: 'work_order', entityId: current._id,
      action: 'updated', changes: { fields: Object.keys(parsed.data), fromStatus: current.status, toStatus: workOrder?.status }
    });
    response.status(200).json({ data: { workOrder } });
  } catch (error) { next(error); }
});

maintenanceRouter.get('/maintenance-plans', async (request, response, next) => {
  try {
    const claims = claimsFor(request);
    const filter: FilterQuery<MaintenancePlanRecord> = { tenantId: new Types.ObjectId(claims.tenantId) };
    if (!admin(claims)) filter.facilityId = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
    if (claims.role === 'technician') filter.assignedTo = new Types.ObjectId(claims.sub);
    if (typeof request.query.active === 'string') filter.active = request.query.active !== 'false';
    const plans = await MaintenancePlan.find(filter).populate('assetId', 'assetTag name')
      .populate('facilityId', 'code name').populate('assignedTo', 'firstName lastName email')
      .sort({ nextDueAt: 1 }).lean();
    response.status(200).json({ data: { plans } });
  } catch (error) { next(error); }
});

maintenanceRouter.post('/maintenance-plans', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const parsed = planCreateSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    const claims = claimsFor(request);
    if (!inScope(claims, parsed.data.facilityId)) { response.status(403).json({ error: { code: 'FACILITY_SCOPE_FORBIDDEN' } }); return; }
    const [facility, asset, assignedValid] = await Promise.all([
      Facility.findOne({ _id: parsed.data.facilityId, tenantId: claims.tenantId, status: 'active' }).select('_id'),
      Asset.findOne({ _id: parsed.data.assetId, tenantId: claims.tenantId, facilityId: parsed.data.facilityId, archivedAt: null }).select('_id'),
      validateAssignment(claims.tenantId, parsed.data.facilityId, parsed.data.assignedTo)
    ]);
    if (!facility) { response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } }); return; }
    if (!asset) { response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } }); return; }
    if (!assignedValid) { response.status(400).json({ error: { code: 'INVALID_TECHNICIAN_ASSIGNMENT' } }); return; }
    const plan = await MaintenancePlan.create({
      ...parsed.data, tenantId: new Types.ObjectId(claims.tenantId),
      facilityId: new Types.ObjectId(parsed.data.facilityId), assetId: new Types.ObjectId(parsed.data.assetId),
      assignedTo: parsed.data.assignedTo ? new Types.ObjectId(parsed.data.assignedTo) : undefined,
      createdBy: new Types.ObjectId(claims.sub), updatedBy: new Types.ObjectId(claims.sub)
    });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId), actorUserId: new Types.ObjectId(claims.sub),
      facilityId: plan.facilityId, entityType: 'maintenance_plan', entityId: plan._id,
      action: 'created', changes: { fields: Object.keys(parsed.data) }
    });
    response.status(201).json({ data: { plan } });
  } catch (error) { next(error); }
});

maintenanceRouter.patch('/maintenance-plans/:planId', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const id = request.params.planId;
    if (typeof id !== 'string' || !objectId(id)) { response.status(400).json({ error: { code: 'INVALID_PLAN_ID' } }); return; }
    const parsed = planUpdateSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    const claims = claimsFor(request);
    const current = await MaintenancePlan.findOne({ _id: id, tenantId: claims.tenantId });
    if (!current || !inScope(claims, current.facilityId.toString())) { response.status(404).json({ error: { code: 'PLAN_NOT_FOUND' } }); return; }
    if (parsed.data.assignedTo && !await validateAssignment(claims.tenantId, current.facilityId.toString(), parsed.data.assignedTo)) {
      response.status(400).json({ error: { code: 'INVALID_TECHNICIAN_ASSIGNMENT' } }); return;
    }
    const update: Record<string, unknown> = { ...parsed.data, updatedBy: new Types.ObjectId(claims.sub) };
    if (parsed.data.assignedTo === null) update.assignedTo = undefined;
    const plan = await MaintenancePlan.findOneAndUpdate({ _id: current._id, tenantId: claims.tenantId }, { $set: update }, { new: true, runValidators: true });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId), actorUserId: new Types.ObjectId(claims.sub),
      facilityId: current.facilityId, entityType: 'maintenance_plan', entityId: current._id,
      action: 'updated', changes: { fields: Object.keys(parsed.data) }
    });
    response.status(200).json({ data: { plan } });
  } catch (error) { next(error); }
});

maintenanceRouter.post('/maintenance-plans/:planId/generate', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const id = request.params.planId;
    if (typeof id !== 'string' || !objectId(id)) { response.status(400).json({ error: { code: 'INVALID_PLAN_ID' } }); return; }
    const claims = claimsFor(request);
    const plan = await MaintenancePlan.findOne({ _id: id, tenantId: claims.tenantId });
    if (!plan || !inScope(claims, plan.facilityId.toString())) { response.status(404).json({ error: { code: 'PLAN_NOT_FOUND' } }); return; }
    if (!plan.active) { response.status(409).json({ error: { code: 'PLAN_INACTIVE' } }); return; }
    const scheduledFor = plan.nextDueAt;
    if (scheduledFor.getTime() > Date.now()) { response.status(409).json({ error: { code: 'PLAN_NOT_DUE', nextDueAt: scheduledFor } }); return; }
    const asset = await Asset.findOne({ _id: plan.assetId, tenantId: claims.tenantId, archivedAt: null }).select('_id');
    if (!asset) { response.status(409).json({ error: { code: 'PLAN_ASSET_UNAVAILABLE' } }); return; }
    const workOrder = await WorkOrder.create({
      tenantId: plan.tenantId, facilityId: plan.facilityId, assetId: plan.assetId,
      workOrderNumber: `PM-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      title: plan.title, description: plan.description, type: 'preventive',
      status: plan.assignedTo ? 'assigned' : 'open', priority: plan.priority,
      assignedTo: plan.assignedTo, scheduledStart: scheduledFor, dueAt: scheduledFor,
      estimatedHours: plan.estimatedHours, sourcePlanId: plan._id, scheduledFor,
      createdBy: new Types.ObjectId(claims.sub), updatedBy: new Types.ObjectId(claims.sub)
    });
    plan.nextDueAt = nextOccurrence(scheduledFor, plan.frequency, plan.interval);
    plan.updatedBy = new Types.ObjectId(claims.sub);
    await plan.save();
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId), actorUserId: new Types.ObjectId(claims.sub),
      facilityId: plan.facilityId, entityType: 'work_order', entityId: workOrder._id,
      action: 'created', changes: { sourcePlanId: plan._id, scheduledFor }
    });
    response.status(201).json({ data: { workOrder, nextDueAt: plan.nextDueAt } });
  } catch (error) { next(error); }
});
