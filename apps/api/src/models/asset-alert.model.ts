import { Schema, model, Types } from 'mongoose';
import type { TelemetryMetric } from './telemetry-reading.model.js';

export type AssetAlertSeverity = 'warning' | 'critical';
export type AssetAlertStatus = 'open' | 'acknowledged' | 'resolved';
export interface AssetAlertRecord {
  tenantId: Types.ObjectId; facilityId: Types.ObjectId; assetId: Types.ObjectId;
  metric: TelemetryMetric; value: number; unit: string; severity: AssetAlertSeverity;
  status: AssetAlertStatus; message: string; firstTriggeredAt: Date; lastTriggeredAt: Date;
  acknowledgedAt?: Date; acknowledgedBy?: Types.ObjectId; resolvedAt?: Date; resolvedBy?: Types.ObjectId;
  workOrderId?: Types.ObjectId;
}
const schema = new Schema<AssetAlertRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
  metric: { type: String, enum: ['temperature_c','vibration_mm_s','pressure_bar','current_amp'], required: true },
  value: { type: Number, required: true }, unit: { type: String, required: true },
  severity: { type: String, enum: ['warning','critical'], required: true },
  status: { type: String, enum: ['open','acknowledged','resolved'], default: 'open', required: true },
  message: { type: String, required: true, maxlength: 240 },
  firstTriggeredAt: { type: Date, required: true }, lastTriggeredAt: { type: Date, required: true },
  acknowledgedAt: Date, acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: Date, resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  workOrderId: { type: Schema.Types.ObjectId, ref: 'WorkOrder' }
}, { timestamps: true });
schema.index({ tenantId: 1, facilityId: 1, status: 1, severity: 1, lastTriggeredAt: -1 });
schema.index({ tenantId: 1, assetId: 1, metric: 1, status: 1 });
export const AssetAlert = model<AssetAlertRecord>('AssetAlert', schema);
