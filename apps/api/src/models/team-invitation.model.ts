import { Schema, model, Types } from 'mongoose';

export interface TeamInvitationRecord {
  tenantId: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'technician' | 'viewer';
  facilityIds: Types.ObjectId[];
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
  cancelledAt?: Date;
}

const invitationSchema = new Schema<TeamInvitationRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  role: { type: String, enum: ['admin', 'manager', 'technician', 'viewer'], required: true },
  facilityIds: [{ type: Schema.Types.ObjectId, ref: 'Facility' }],
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: { type: Date },
  cancelledAt: { type: Date }
}, { timestamps: true });

invitationSchema.index({ tenantId: 1, email: 1, acceptedAt: 1, cancelledAt: 1 });
export const TeamInvitation = model<TeamInvitationRecord>('TeamInvitation', invitationSchema);
