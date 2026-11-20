import { Schema, model, Types } from 'mongoose';

// One document per refresh-token family makes rotation a single atomic compare-and-swap.
const refreshSessionSchema = new Schema({
  userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  usedTokenHashes: { type: [String], default: [], select: false },
  familyId: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

export const RefreshSession = model('RefreshSession', refreshSessionSchema);