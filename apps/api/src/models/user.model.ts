import { Schema, model, Types } from 'mongoose';

export type UserRole = 'owner' | 'admin' | 'manager' | 'technician' | 'viewer';

export interface UserRecord {
  tenantId: Types.ObjectId;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  facilityIds: Types.ObjectId[];
  status: 'active' | 'disabled';
  lastLoginAt?: Date;
}

const userSchema = new Schema<UserRecord>({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  role: { type: String, enum: ['owner', 'admin', 'manager', 'technician', 'viewer'], default: 'owner', required: true },
  facilityIds: [{ type: Types.ObjectId, ref: 'Facility' }],
  status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
  lastLoginAt: { type: Date }
}, { timestamps: true });

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

export const User = model<UserRecord>('User', userSchema);
