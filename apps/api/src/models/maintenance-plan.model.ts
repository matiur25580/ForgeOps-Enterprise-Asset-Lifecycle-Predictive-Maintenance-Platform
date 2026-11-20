import { Schema, model, Types } from 'mongoose';

export type MaintenanceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface MaintenancePlanRecord {
  tenantId: Types.ObjectId;
  facilityId: Types.ObjectId;
  assetId: Types.ObjectId;
  planCode: string;
  title: string;
  description?: string;
  frequency: MaintenanceFrequency;
  interval: number;
  nextDueAt: Date;
  estimatedHours?: number;
  priority: 'low' | 'medium' | 'high' | 'emergency';
  assignedTo?: Types.ObjectId;
  active: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}

const maintenancePlanSchema = new Schema<MaintenancePlanRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
  planCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 4000 },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], required: true },
  interval: { type: Number, min: 1, max: 365, default: 1, required: true },
  nextDueAt: { type: Date, required: true },
  estimatedHours: { type: Number, min: 0, max: 10000 },
  priority: { type: String, enum: ['low', 'medium', 'high', 'emergency'], default: 'medium', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  active: { type: Boolean, default: true, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

maintenancePlanSchema.index({ tenantId: 1, planCode: 1 }, { unique: true });
maintenancePlanSchema.index({ tenantId: 1, facilityId: 1, active: 1, nextDueAt: 1 });

export const MaintenancePlan = model<MaintenancePlanRecord>('MaintenancePlan', maintenancePlanSchema);
