import { Schema, model, Types } from 'mongoose';

export interface AuditEventRecord {
  tenantId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  facilityId?: Types.ObjectId;
  entityType: 'facility' | 'asset';
  entityId: Types.ObjectId;
  action: 'created' | 'updated' | 'archived';
  changes?: Record<string, unknown>;
  occurredAt: Date;
}

const auditEventSchema = new Schema<AuditEventRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility' },
  entityType: { type: String, enum: ['facility', 'asset'], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['created', 'updated', 'archived'], required: true },
  changes: { type: Schema.Types.Mixed },
  occurredAt: { type: Date, default: Date.now, required: true }
}, { versionKey: false, timestamps: false });

auditEventSchema.index({ tenantId: 1, entityType: 1, entityId: 1, occurredAt: -1 });
auditEventSchema.index({ tenantId: 1, facilityId: 1, occurredAt: -1 });

export const AuditEvent = model<AuditEventRecord>('AuditEvent', auditEventSchema);
