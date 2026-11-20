import { Schema, model, Types } from 'mongoose';

const refreshSessionSchema = new Schema({
  userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  replacedByHash: { type: String, default: null }
}, { timestamps: true });

export const RefreshSession = model('RefreshSession', refreshSessionSchema);