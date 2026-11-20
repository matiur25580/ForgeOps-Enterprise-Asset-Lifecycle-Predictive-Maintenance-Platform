import { Schema, model, Types } from 'mongoose';
export interface VendorRecord {
  tenantId: Types.ObjectId;
  vendorCode: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: { line1?: string; city?: string; region?: string; postalCode?: string; country?: string };
  status: 'active' | 'inactive' | 'under_review';
  paymentTerms?: string;
  notes?: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}
const schema = new Schema<VendorRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  vendorCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  contactName: { type: String, trim: true, maxlength: 120 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 40 },
  website: { type: String, trim: true, maxlength: 240 },
  address: {
    line1: { type: String, trim: true, maxlength: 160 }, city: { type: String, trim: true, maxlength: 100 },
    region: { type: String, trim: true, maxlength: 100 }, postalCode: { type: String, trim: true, maxlength: 24 },
    country: { type: String, trim: true, maxlength: 80 }
  },
  status: { type: String, enum: ['active','inactive','under_review'], default: 'active', required: true },
  paymentTerms: { type: String, trim: true, maxlength: 80 },
  notes: { type: String, trim: true, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ tenantId: 1, vendorCode: 1 }, { unique: true });
schema.index({ tenantId: 1, name: 1 });
export const Vendor = model<VendorRecord>('Vendor', schema);
