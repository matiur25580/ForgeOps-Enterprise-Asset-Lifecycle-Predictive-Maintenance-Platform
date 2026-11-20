import { Schema, model, Types } from 'mongoose';

export interface FacilityRecord {
  tenantId: Types.ObjectId;
  code: string;
  name: string;
  facilityType: 'manufacturing' | 'warehouse' | 'office' | 'hospital' | 'data-center' | 'utility' | 'other';
  status: 'active' | 'inactive';
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  timezone: string;
}

const facilitySchema = new Schema<FacilityRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  facilityType: {
    type: String,
    enum: ['manufacturing', 'warehouse', 'office', 'hospital', 'data-center', 'utility', 'other'],
    required: true
  },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', required: true },
  address: {
    line1: { type: String, trim: true, maxlength: 160 },
    city: { type: String, trim: true, maxlength: 100 },
    region: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 24 },
    country: { type: String, trim: true, maxlength: 80 }
  },
  timezone: { type: String, default: 'UTC', required: true, maxlength: 64 }
}, { timestamps: true });

facilitySchema.index({ tenantId: 1, code: 1 }, { unique: true });
facilitySchema.index({ tenantId: 1, status: 1, name: 1 });

export const Facility = model<FacilityRecord>('Facility', facilitySchema);
