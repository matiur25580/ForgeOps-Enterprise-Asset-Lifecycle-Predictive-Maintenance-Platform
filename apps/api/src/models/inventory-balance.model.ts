import { Schema, model, Types } from 'mongoose';
export interface InventoryBalanceRecord {
  tenantId: Types.ObjectId; facilityId: Types.ObjectId; sparePartId: Types.ObjectId;
  onHand: number; reserved: number; reorderPoint: number; binLocation?: string;
  updatedBy: Types.ObjectId;
}
const schema = new Schema<InventoryBalanceRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  sparePartId: { type: Schema.Types.ObjectId, ref: 'SparePart', required: true },
  onHand: { type: Number, min: 0, default: 0, required: true },
  reserved: { type: Number, min: 0, default: 0, required: true },
  reorderPoint: { type: Number, min: 0, default: 0, required: true },
  binLocation: { type: String, trim: true, maxlength: 80 },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ tenantId: 1, facilityId: 1, sparePartId: 1 }, { unique: true });
schema.index({ tenantId: 1, facilityId: 1, onHand: 1, reorderPoint: 1 });
export const InventoryBalance = model<InventoryBalanceRecord>('InventoryBalance', schema);
