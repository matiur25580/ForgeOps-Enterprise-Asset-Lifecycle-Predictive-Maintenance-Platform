import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { AuditEvent } from '../models/audit-event.model.js';
import { Facility } from '../models/facility.model.js';
import { RefreshSession } from '../models/refresh-session.model.js';
import { TeamInvitation } from '../models/team-invitation.model.js';
import { User, type UserRole } from '../models/user.model.js';

export const teamRouter = Router();
const assignableRoles = ['admin', 'manager', 'technician', 'viewer'] as const;
const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(assignableRoles),
  facilityIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).default([])
});
const updateSchema = z.object({
  role: z.enum(['owner', ...assignableRoles]).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  facilityIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).optional()
}).refine((value) => Object.keys(value).length > 0);
const acceptSchema = z.object({
  token: z.string().min(32).max(256),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72)
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function canAdminister(role: UserRole) { return role === 'owner' || role === 'admin'; }
function forbidden(res: import('express').Response) {
  res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organization owners and administrators can manage team members.' } });
}
async function validateFacilities(tenantId: Types.ObjectId, ids: string[]) {
  if (!ids.length) return true;
  const unique = [...new Set(ids)];
  return await Facility.countDocuments({ tenantId, _id: { $in: unique.map((id) => new Types.ObjectId(id)) }, status: 'active' }) === unique.length;
}
async function audit(tenantId: Types.ObjectId, actorUserId: Types.ObjectId, entityId: Types.ObjectId, action: 'created' | 'updated' | 'archived', changes: Record<string, unknown>) {
  await AuditEvent.create({ tenantId, actorUserId, entityType: 'team_invitation', entityId, action, changes });
}

teamRouter.get('/members', authenticate, async (req, res, next) => {
  try {
    if (!canAdminister(req.auth!.role)) { forbidden(res); return; }
    const tenantId = new Types.ObjectId(req.auth!.tenantId);
    const members = await User.find({ tenantId }).select('_id email firstName lastName role facilityIds status lastLoginAt createdAt updatedAt').sort({ role: 1, firstName: 1 }).lean();
    res.status(200).json({ data: { members } });
  } catch (error) { next(error); }
});

teamRouter.get('/invitations', authenticate, async (req, res, next) => {
  try {
    if (!canAdminister(req.auth!.role)) { forbidden(res); return; }
    const invitations = await TeamInvitation.find({
      tenantId: new Types.ObjectId(req.auth!.tenantId),
      acceptedAt: null, cancelledAt: null, expiresAt: { $gt: new Date() }
    }).select('-tokenHash').sort({ createdAt: -1 }).limit(100).lean();
    res.status(200).json({ data: { invitations } });
  } catch (error) { next(error); }
});

teamRouter.post('/invitations', authenticate, async (req, res, next) => {
  try {
    const claims = req.auth!;
    if (!canAdminister(claims.role)) { forbidden(res); return; }
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    if (parsed.data.role === 'admin' && claims.role !== 'owner') { res.status(403).json({ error: { code: 'OWNER_REQUIRED_FOR_ADMIN_INVITE' } }); return; }
    const tenantId = new Types.ObjectId(claims.tenantId);
    const email = parsed.data.email.toLowerCase();
    if (await User.exists({ tenantId, email })) { res.status(409).json({ error: { code: 'TEAM_MEMBER_ALREADY_EXISTS' } }); return; }
    if (!await validateFacilities(tenantId, parsed.data.facilityIds)) { res.status(400).json({ error: { code: 'INVALID_FACILITY_SCOPE' } }); return; }
    const activeInvite = await TeamInvitation.findOne({ tenantId, email, acceptedAt: null, cancelledAt: null, expiresAt: { $gt: new Date() } }).select('_id');
    if (activeInvite) { res.status(409).json({ error: { code: 'INVITATION_ALREADY_PENDING' } }); return; }
    const token = randomBytes(36).toString('base64url');
    const invitation = await TeamInvitation.create({
      tenantId, email, firstName: parsed.data.firstName, lastName: parsed.data.lastName,
      role: parsed.data.role, facilityIds: parsed.data.facilityIds.map((id) => new Types.ObjectId(id)),
      tokenHash: hash(token), invitedBy: new Types.ObjectId(claims.sub),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
    });
    await audit(tenantId, new Types.ObjectId(claims.sub), invitation._id, 'created', { email, role: invitation.role, facilityIds: parsed.data.facilityIds });
    res.status(201).json({ data: { invitation: { id: invitation._id, email, role: invitation.role, facilityIds: invitation.facilityIds, expiresAt: invitation.expiresAt }, invitationToken: token, delivery: 'manual_share_required' } });
  } catch (error) { next(error); }
});

teamRouter.post('/invitations/accept', async (req, res, next) => {
  try {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    const invitation = await TeamInvitation.findOne({ tokenHash: hash(parsed.data.token), acceptedAt: null, cancelledAt: null, expiresAt: { $gt: new Date() } }).select('+tokenHash');
    if (!invitation) { res.status(404).json({ error: { code: 'INVITATION_INVALID_OR_EXPIRED' } }); return; }
    if (parsed.data.firstName.trim().toLowerCase() !== invitation.firstName.toLowerCase() || parsed.data.lastName.trim().toLowerCase() !== invitation.lastName.toLowerCase()) {
      res.status(400).json({ error: { code: 'INVITATION_IDENTITY_MISMATCH' } }); return;
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await User.create({
      tenantId: invitation.tenantId, email: invitation.email, passwordHash,
      firstName: invitation.firstName, lastName: invitation.lastName,
      role: invitation.role, facilityIds: invitation.facilityIds, status: 'active'
    });
    invitation.acceptedAt = new Date();
    await invitation.save();
    await audit(invitation.tenantId, invitation.invitedBy, invitation._id, 'updated', { acceptedBy: user._id.toString(), acceptedAt: invitation.acceptedAt });
    res.status(201).json({ data: { user: { id: user._id, email: user.email, role: user.role, facilityIds: user.facilityIds } } });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as {code?:number}).code === 11000) {
      res.status(409).json({ error: { code: 'TEAM_MEMBER_ALREADY_EXISTS' } }); return;
    }
    next(error);
  }
});

teamRouter.patch('/members/:userId', authenticate, async (req, res, next) => {
  try {
    const claims = req.auth!;
    if (!canAdminister(claims.role)) { forbidden(res); return; }
    const userId = String(req.params.userId ?? '');
    if (!Types.ObjectId.isValid(userId)) { res.status(400).json({ error: { code: 'INVALID_USER_ID' } }); return; }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } }); return; }
    if (userId === claims.sub) { res.status(409).json({ error: { code: 'SELF_MODIFICATION_NOT_ALLOWED' } }); return; }
    if (parsed.data.role === 'owner') { res.status(403).json({ error: { code: 'OWNER_ROLE_NOT_ASSIGNABLE' } }); return; }
    if (parsed.data.role === 'admin' && claims.role !== 'owner') { res.status(403).json({ error: { code: 'OWNER_REQUIRED_FOR_ADMIN_ROLE' } }); return; }
    const tenantId = new Types.ObjectId(claims.tenantId);
    const member = await User.findOne({ _id: userId, tenantId });
    if (!member) { res.status(404).json({ error: { code: 'TEAM_MEMBER_NOT_FOUND' } }); return; }
    if (member.role === 'owner') { res.status(403).json({ error: { code: 'OWNER_ACCOUNT_PROTECTED' } }); return; }
    if (parsed.data.facilityIds && !await validateFacilities(tenantId, parsed.data.facilityIds)) { res.status(400).json({ error: { code: 'INVALID_FACILITY_SCOPE' } }); return; }
    if (member.role === 'admin' && claims.role !== 'owner') { res.status(403).json({ error: { code: 'OWNER_REQUIRED_TO_MODIFY_ADMIN' } }); return; }
    const changes: Record<string, unknown> = {};
    if (parsed.data.role !== undefined) { member.role = parsed.data.role; changes.role = parsed.data.role; }
    if (parsed.data.status !== undefined) { member.status = parsed.data.status; changes.status = parsed.data.status; }
    if (parsed.data.facilityIds !== undefined) { member.facilityIds = parsed.data.facilityIds.map((id) => new Types.ObjectId(id)); changes.facilityIds = parsed.data.facilityIds; }
    await member.save();
    if (member.status === 'disabled') await RefreshSession.updateMany({ tenantId, userId: member._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await AuditEvent.create({ tenantId, actorUserId: new Types.ObjectId(claims.sub), entityType: 'team_member', entityId: member._id, action: 'updated', changes });
    res.status(200).json({ data: { member: { id: member._id, email: member.email, firstName: member.firstName, lastName: member.lastName, role: member.role, facilityIds: member.facilityIds, status: member.status } } });
  } catch (error) { next(error); }
});

teamRouter.delete('/invitations/:invitationId', authenticate, async (req, res, next) => {
  try {
    if (!canAdminister(req.auth!.role)) { forbidden(res); return; }
    const invitationId = String(req.params.invitationId ?? '');
    if (!Types.ObjectId.isValid(invitationId)) { res.status(400).json({ error: { code: 'INVALID_INVITATION_ID' } }); return; }
    const tenantId = new Types.ObjectId(req.auth!.tenantId);
    const invitation = await TeamInvitation.findOneAndUpdate(
      { _id: invitationId, tenantId, acceptedAt: null, cancelledAt: null },
      { $set: { cancelledAt: new Date() } }, { new: true }
    );
    if (!invitation) { res.status(404).json({ error: { code: 'INVITATION_NOT_FOUND' } }); return; }
    await audit(tenantId, new Types.ObjectId(req.auth!.sub), invitation._id, 'archived', { cancelledAt: invitation.cancelledAt });
    res.status(204).send();
  } catch (error) { next(error); }
});
