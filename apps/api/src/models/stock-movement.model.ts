import { Schema, model, Types } from 'mongoose';
export interface StockMovementRecord {
  tenantId: Types.ObjectId; facilityId: Types.ObjectId; sparePartId: Types.ObjectId;
  movementType: 'receipt' | 'issue' | 'adjustment';
  quantity: number; quantityBefore: number; quantityAfter: number;
  unitCost?: number; reference?: string; reason: string;
  workOrderId?: Types.ObjectId; vendorId?: Types.ObjectId;
  performedBy: Types.ObjectId; occurredAt: Date;
}
const schema = new Schema<StockMovementRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  sparePartId: { type: Schema.Types.ObjectId, ref: 'SparePart', required: true },
  movementType: { type: String, enum: ['receipt','issue','adjustment'], required: true },
  quantity: { type: Number, required: true },
  quantityBefore: { type: Number, min: 0, required: true },
  quantityAfter: { type: Number, min: 0, required: true },
  unitCost: { type: Number, min: 0 },
  reference: { type: String, trim: true, maxlength: 120 },
  reason: { type: String, trim: true, maxlength: 500, required: true },
  workOrderId: { type: Schema.Types.ObjectId, ref: 'WorkOrder' },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  occurredAt: { type: Date, default: Date.now, required: true }
}, { timestamps: false, versionKey: false });
schema.index({ tenantId: 1, facilityId: 1, sparePartId: 1, occurredAt: -1 });
schema.index({ tenantId: 1, workOrderId: 1 });
export const StockMovement = model<StockMovementRecord>('StockMovement', schema);
