import { Schema, model, Types } from 'mongoose';

export type AssetCriticality = 'low' | 'medium' | 'high' | 'critical';
export type AssetLifecycleStatus = 'commissioning' | 'operational' | 'maintenance' | 'retired' | 'disposed';
export type AssetCondition = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface AssetRecord {
  tenantId: Types.ObjectId;
  facilityId: Types.ObjectId;
  assetTag: string;
  name: string;
  category: string;
  description?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  criticality: AssetCriticality;
  lifecycleStatus: AssetLifecycleStatus;
  condition: AssetCondition;
  commissionedAt?: Date;
  warrantyExpiresAt?: Date;
  purchaseCost?: number;
  salvageValue?: number;
  usefulLifeMonths?: number;
  depreciationMethod: 'straight_line';
  depreciationStartDate?: Date;
  warrantyProvider?: string;
  warrantyReference?: string;
  warrantyNotes?: string;
  currency: string;
  scheduledOperatingHoursPerWeek?: number;
  parentAssetId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  archivedAt?: Date;
}

const assetSchema = new Schema<AssetRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  assetTag: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 2000 },
  manufacturer: { type: String, trim: true, maxlength: 120 },
  modelNumber: { type: String, trim: true, maxlength: 120 },
  serialNumber: { type: String, trim: true, maxlength: 120 },
  criticality: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', required: true },
  lifecycleStatus: {
    type: String,
    enum: ['commissioning', 'operational', 'maintenance', 'retired', 'disposed'],
    default: 'commissioning',
    required: true
  },
  condition: { type: String, enum: ['excellent', 'good', 'fair', 'poor', 'unknown'], default: 'unknown', required: true },
  commissionedAt: { type: Date },
  warrantyExpiresAt: { type: Date },
  purchaseCost: { type: Number, min: 0 },
  salvageValue: { type: Number, min: 0 },
  usefulLifeMonths: { type: Number, min: 1, max: 1200 },
  depreciationMethod: { type: String, enum: ['straight_line'], default: 'straight_line', required: true },
  depreciationStartDate: { type: Date },
  warrantyProvider: { type: String, trim: true, maxlength: 160 },
  warrantyReference: { type: String, trim: true, maxlength: 120 },
  warrantyNotes: { type: String, trim: true, maxlength: 1000 },
  currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3, required: true },
  scheduledOperatingHoursPerWeek: { type: Number, min: 0, max: 168 },
  parentAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  archivedAt: { type: Date, default: null }
}, { timestamps: true });

assetSchema.index({ tenantId: 1, assetTag: 1 }, { unique: true });
assetSchema.index({ tenantId: 1, facilityId: 1, lifecycleStatus: 1, archivedAt: 1 });
assetSchema.index({ tenantId: 1, category: 1, criticality: 1 });
assetSchema.index(
  { tenantId: 1, serialNumber: 1 },
  { unique: true, partialFilterExpression: { serialNumber: { $type: 'string' } } }
);

export const Asset = model<AssetRecord>('Asset', assetSchema);
