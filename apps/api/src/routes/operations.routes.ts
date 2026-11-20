import { Router, type Request } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import type { AssetRecord } from '../models/asset.model.js';
import type { FacilityRecord } from '../models/facility.model.js';
import { Asset } from '../models/asset.model.js';
import { AuditEvent } from '../models/audit-event.model.js';
import { Facility } from '../models/facility.model.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const operationsRouter = Router();
operationsRouter.use(authenticate);

const facilityTypes = ['manufacturing', 'warehouse', 'office', 'hospital', 'data-center', 'utility', 'other'] as const;
const facilitySchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  facilityType: z.enum(facilityTypes),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  address: z.object({
    line1: z.string().trim().max(160).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(24).optional(),
    country: z.string().trim().max(80).optional()
  }).optional()
}).strict();

const assetCreateSchema = z.object({
  facilityId: z.string().refine(Types.ObjectId.isValid, 'Invalid facility identifier.'),
  assetTag: z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  modelNumber: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  criticality: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  lifecycleStatus: z.enum(['commissioning', 'operational', 'maintenance', 'retired', 'disposed']).default('commissioning'),
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'unknown']).default('unknown'),
  commissionedAt: z.coerce.date().optional(),
  warrantyExpiresAt: z.coerce.date().optional(),
  purchaseCost: z.number().finite().nonnegative().max(1000000000).optional(),
  salvageValue: z.number().finite().nonnegative().max(1000000000).optional(),
  usefulLifeMonths: z.number().int().min(1).max(1200).optional(),
  depreciationMethod: z.enum(['straight_line']).default('straight_line'),
  depreciationStartDate: z.coerce.date().optional(),
  warrantyProvider: z.string().trim().max(160).optional(),
  warrantyReference: z.string().trim().max(120).optional(),
  warrantyNotes: z.string().trim().max(1000).optional(),
  currency: z.string().trim().length(3).default('USD'),
  scheduledOperatingHoursPerWeek: z.number().finite().min(0).max(168).optional(),
  parentAssetId: z.string().refine(Types.ObjectId.isValid).optional()
}).strict();

const assetUpdateSchema = assetCreateSchema.omit({ assetTag: true }).partial().extend({
  assetTag: z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9._-]+$/).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.');

function claimsFor(request: Request): AccessClaims {
  return request.auth!;
}

function isTenantAdministrator(claims: AccessClaims): boolean {
  return claims.role === 'owner' || claims.role === 'admin';
}

function canAccessFacility(claims: AccessClaims, facilityId: string): boolean {
  return isTenantAdministrator(claims) || claims.facilityIds.includes(facilityId);
}

function scopedFacilityFilter(claims: AccessClaims): FilterQuery<FacilityRecord> {
  return isTenantAdministrator(claims)
    ? { tenantId: new Types.ObjectId(claims.tenantId) }
    : { tenantId: new Types.ObjectId(claims.tenantId), _id: { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) } };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Facilities are tenant-owned operational boundaries. Only tenant administrators
// can provision or change them; non-admin users see assigned facilities only.
operationsRouter.get('/facilities', async (request, response, next) => {
  try {
    const claims = claimsFor(request);
    const facilities = await Facility.find(scopedFacilityFilter(claims)).sort({ name: 1 }).lean();
    response.status(200).json({ data: { facilities } });
  } catch (error) { next(error); }
});

operationsRouter.post('/facilities', authorize('owner', 'admin'), async (request, response, next) => {
  try {
    const parsed = facilitySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const claims = claimsFor(request);
    const facility = await Facility.create({ ...parsed.data, tenantId: new Types.ObjectId(claims.tenantId) });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId),
      actorUserId: new Types.ObjectId(claims.sub),
      entityType: 'facility',
      entityId: facility._id,
      action: 'created',
      changes: { fields: Object.keys(parsed.data) }
    });
    response.status(201).json({ data: { facility } });
  } catch (error) { next(error); }
});

operationsRouter.patch('/facilities/:facilityId', authorize('owner', 'admin'), async (request, response, next) => {
  try {
    const facilityId = request.params.facilityId;
    if (typeof facilityId !== 'string' || !Types.ObjectId.isValid(facilityId)) {
      response.status(400).json({ error: { code: 'INVALID_FACILITY_ID' } });
      return;
    }
    const parsed = facilitySchema.partial().strict().refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const claims = claimsFor(request);
    const facility = await Facility.findOneAndUpdate(
      { _id: facilityId, tenantId: claims.tenantId },
      { $set: parsed.data },
      { new: true, runValidators: true }
    );
    if (!facility) {
      response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } });
      return;
    }
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId),
      actorUserId: new Types.ObjectId(claims.sub),
      entityType: 'facility',
      entityId: facility._id,
      action: 'updated',
      changes: { fields: Object.keys(parsed.data) }
    });
    response.status(200).json({ data: { facility } });
  } catch (error) { next(error); }
});

// Asset registry: every query is tenant-scoped, and non-admin access is
// additionally constrained to the facilities embedded in the verified token.
operationsRouter.get('/assets', async (request, response, next) => {
  try {
    const claims = claimsFor(request);
    const page = Math.max(1, Math.min(100_000, Number(request.query.page) || 1));
    const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
    const filter: FilterQuery<AssetRecord> = {
      tenantId: new Types.ObjectId(claims.tenantId),
      archivedAt: null
    };
    if (!isTenantAdministrator(claims)) {
      filter.facilityId = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
    }
    if (typeof request.query.facilityId === 'string') {
      if (!Types.ObjectId.isValid(request.query.facilityId) || !canAccessFacility(claims, request.query.facilityId)) {
        response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } });
        return;
      }
      filter.facilityId = new Types.ObjectId(request.query.facilityId);
    }
    if (typeof request.query.lifecycleStatus === 'string') filter.lifecycleStatus = request.query.lifecycleStatus as AssetRecord['lifecycleStatus'];
    if (typeof request.query.criticality === 'string') filter.criticality = request.query.criticality as AssetRecord['criticality'];
    if (typeof request.query.category === 'string') filter.category = request.query.category.toLowerCase();
    if (typeof request.query.q === 'string' && request.query.q.trim()) {
      const expression = escapeRegex(request.query.q.trim().slice(0, 80));
      filter.$or = [
        { assetTag: { $regex: expression, $options: 'i' } },
        { name: { $regex: expression, $options: 'i' } },
        { serialNumber: { $regex: expression, $options: 'i' } }
      ];
    }
    const [assets, total] = await Promise.all([
      Asset.find(filter).populate('facilityId', 'code name').sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Asset.countDocuments(filter)
    ]);
    response.status(200).json({
      data: { assets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) { next(error); }
});

operationsRouter.post('/assets', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const parsed = assetCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const claims = claimsFor(request);
    if (!canAccessFacility(claims, parsed.data.facilityId)) {
      response.status(403).json({ error: { code: 'FACILITY_SCOPE_FORBIDDEN' } });
      return;
    }
    const facility = await Facility.findOne({
      _id: parsed.data.facilityId,
      tenantId: claims.tenantId,
      status: 'active'
    }).select('_id');
    if (!facility) {
      response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } });
      return;
    }
    if (parsed.data.parentAssetId) {
      const parent = await Asset.findOne({
        _id: parsed.data.parentAssetId,
        tenantId: claims.tenantId,
        facilityId: parsed.data.facilityId,
        archivedAt: null
      }).select('_id');
      if (!parent) {
        response.status(400).json({ error: { code: 'INVALID_PARENT_ASSET' } });
        return;
      }
    }
    const asset = await Asset.create({
      ...parsed.data,
      facilityId: new Types.ObjectId(parsed.data.facilityId),
      parentAssetId: parsed.data.parentAssetId ? new Types.ObjectId(parsed.data.parentAssetId) : undefined,
      tenantId: new Types.ObjectId(claims.tenantId),
      createdBy: new Types.ObjectId(claims.sub),
      updatedBy: new Types.ObjectId(claims.sub)
    });
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId),
      actorUserId: new Types.ObjectId(claims.sub),
      facilityId: asset.facilityId,
      entityType: 'asset',
      entityId: asset._id,
      action: 'created',
      changes: { fields: Object.keys(parsed.data) }
    });
    response.status(201).json({ data: { asset } });
  } catch (error) { next(error); }
});

operationsRouter.get('/assets/:assetId/audit', async (request, response, next) => {
  try {
    const assetId = request.params.assetId;
    if (typeof assetId !== 'string' || !Types.ObjectId.isValid(assetId)) {
      response.status(400).json({ error: { code: 'INVALID_ASSET_ID' } });
      return;
    }
    const claims = claimsFor(request);
    const asset = await Asset.findOne({
      _id: assetId,
      tenantId: claims.tenantId,
      archivedAt: null,
      ...(isTenantAdministrator(claims) ? {} : { facilityId: { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) } })
    }).select('_id');
    if (!asset) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    const events = await AuditEvent.find({
      tenantId: claims.tenantId,
      entityType: 'asset',
      entityId: asset._id
    }).sort({ occurredAt: -1 }).limit(100).lean();
    response.status(200).json({ data: { events } });
  } catch (error) { next(error); }
});

operationsRouter.get('/assets/:assetId', async (request, response, next) => {
  try {
    const assetId = request.params.assetId;
    if (typeof assetId !== 'string' || !Types.ObjectId.isValid(assetId)) {
      response.status(400).json({ error: { code: 'INVALID_ASSET_ID' } });
      return;
    }
    const claims = claimsFor(request);
    const filter: FilterQuery<AssetRecord> = {
      _id: assetId,
      tenantId: claims.tenantId,
      archivedAt: null
    };
    if (!isTenantAdministrator(claims)) {
      filter.facilityId = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
    }
    const asset = await Asset.findOne(filter).populate('facilityId', 'code name').lean();
    if (!asset) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    response.status(200).json({ data: { asset } });
  } catch (error) { next(error); }
});

operationsRouter.patch('/assets/:assetId', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const assetId = request.params.assetId;
    if (typeof assetId !== 'string' || !Types.ObjectId.isValid(assetId)) {
      response.status(400).json({ error: { code: 'INVALID_ASSET_ID' } });
      return;
    }
    const parsed = assetUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const claims = claimsFor(request);
    const existing = await Asset.findOne({
      _id: assetId,
      tenantId: claims.tenantId,
      archivedAt: null
    });
    if (!existing) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    if (!canAccessFacility(claims, existing.facilityId.toString())) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    const nextFacilityId = parsed.data.facilityId ?? existing.facilityId.toString();
    if (!canAccessFacility(claims, nextFacilityId)) {
      response.status(403).json({ error: { code: 'FACILITY_SCOPE_FORBIDDEN' } });
      return;
    }
    const facility = await Facility.findOne({ _id: nextFacilityId, tenantId: claims.tenantId, status: 'active' }).select('_id');
    if (!facility) {
      response.status(404).json({ error: { code: 'FACILITY_NOT_FOUND' } });
      return;
    }
    if (parsed.data.parentAssetId) {
      const parent = await Asset.findOne({
        _id: parsed.data.parentAssetId,
        tenantId: claims.tenantId,
        facilityId: nextFacilityId,
        archivedAt: null
      }).select('_id');
      if (!parent) {
        response.status(400).json({ error: { code: 'INVALID_PARENT_ASSET' } });
        return;
      }
    }
    const updates: Record<string, unknown> = {
      ...parsed.data,
      updatedBy: new Types.ObjectId(claims.sub)
    };
    if (parsed.data.facilityId) updates.facilityId = new Types.ObjectId(nextFacilityId);
    if (parsed.data.parentAssetId) updates.parentAssetId = new Types.ObjectId(parsed.data.parentAssetId);
    const asset = await Asset.findOneAndUpdate(
      { _id: existing._id, tenantId: claims.tenantId, archivedAt: null },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!asset) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId),
      actorUserId: new Types.ObjectId(claims.sub),
      facilityId: asset.facilityId,
      entityType: 'asset',
      entityId: asset._id,
      action: 'updated',
      changes: { fields: Object.keys(parsed.data) }
    });
    response.status(200).json({ data: { asset } });
  } catch (error) { next(error); }
});

operationsRouter.delete('/assets/:assetId', authorize('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const assetId = request.params.assetId;
    if (typeof assetId !== 'string' || !Types.ObjectId.isValid(assetId)) {
      response.status(400).json({ error: { code: 'INVALID_ASSET_ID' } });
      return;
    }
    const claims = claimsFor(request);
    const filter: FilterQuery<AssetRecord> = {
      _id: assetId,
      tenantId: claims.tenantId,
      archivedAt: null
    };
    if (!isTenantAdministrator(claims)) filter.facilityId = { $in: claims.facilityIds.map((id) => new Types.ObjectId(id)) };
    const asset = await Asset.findOneAndUpdate(
      filter,
      { $set: { archivedAt: new Date(), updatedBy: new Types.ObjectId(claims.sub) } },
      { new: true }
    );
    if (!asset) {
      response.status(404).json({ error: { code: 'ASSET_NOT_FOUND' } });
      return;
    }
    await AuditEvent.create({
      tenantId: new Types.ObjectId(claims.tenantId),
      actorUserId: new Types.ObjectId(claims.sub),
      facilityId: asset.facilityId,
      entityType: 'asset',
      entityId: asset._id,
      action: 'archived',
      changes: { archivedAt: asset.archivedAt }
    });
    response.status(204).send();
  } catch (error) { next(error); }
});
