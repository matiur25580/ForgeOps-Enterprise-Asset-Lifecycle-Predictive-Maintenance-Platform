import { Schema, model, Types } from 'mongoose';

export interface SparePartRecord {
  tenantId: Types.ObjectId;
  partNumber: string;
  name: string;
  description?: string;
  category: string;
  unitOfMeasure: 'each' | 'box' | 'liter' | 'kilogram' | 'meter' | 'set';
  manufacturer?: string;
  manufacturerPartNumber?: string;
  unitCost: number;
  currency: string;
  preferredVendorId?: Types.ObjectId;
  active: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}
const schema = new Schema<SparePartRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  partNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 2000 },
  category: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
  unitOfMeasure: { type: String, enum: ['each','box','liter','kilogram','meter','set'], default: 'each', required: true },
  manufacturer: { type: String, trim: true, maxlength: 120 },
  manufacturerPartNumber: { type: String, trim: true, maxlength: 120 },
  unitCost: { type: Number, min: 0, required: true },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: 'USD', required: true },
  preferredVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  active: { type: Boolean, default: true, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ tenantId: 1, partNumber: 1 }, { unique: true });
schema.index({ tenantId: 1, category: 1, active: 1 });
export const SparePart = model<SparePartRecord>('SparePart', schema);
