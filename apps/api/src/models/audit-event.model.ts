import { Schema, model, Types } from 'mongoose';

export interface AuditEventRecord {
  tenantId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  facilityId?: Types.ObjectId;
  entityType: 'facility' | 'asset' | 'work_order' | 'maintenance_plan' | 'vendor' | 'spare_part' | 'stock_movement' | 'purchase_requisition' | 'purchase_order' | 'goods_receipt' | 'asset_alert' | 'inspection' | 'inspection_template' | 'downtime_event' | 'vendor_contract' | 'team_member' | 'team_invitation';
  entityId: Types.ObjectId;
  action: 'created' | 'updated' | 'archived' | 'acknowledged' | 'resolved';
  changes?: Record<string, unknown>;
  occurredAt: Date;
}

const auditEventSchema = new Schema<AuditEventRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility' },
  entityType: { type: String, enum: ['facility', 'asset', 'work_order', 'maintenance_plan', 'vendor', 'spare_part', 'stock_movement', 'purchase_requisition', 'purchase_order', 'goods_receipt', 'asset_alert', 'inspection', 'inspection_template', 'downtime_event', 'vendor_contract', 'team_member', 'team_invitation'], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'archived', 'acknowledged', 'resolved'], required: true },
  changes: { type: Schema.Types.Mixed },
  occurredAt: { type: Date, default: Date.now, required: true }
}, { versionKey: false, timestamps: false });

auditEventSchema.index({ tenantId: 1, entityType: 1, entityId: 1, occurredAt: -1 });
auditEventSchema.index({ tenantId: 1, facilityId: 1, occurredAt: -1 });

export const AuditEvent = model<AuditEventRecord>('AuditEvent', auditEventSchema);
