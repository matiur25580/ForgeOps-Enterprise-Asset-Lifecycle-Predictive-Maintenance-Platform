import { Schema, model, Types } from 'mongoose';
import type { TelemetryMetric } from './telemetry-reading.model.js';

export interface TelemetryAlertRuleRecord {
  tenantId: Types.ObjectId;
  metric: TelemetryMetric;
  warningThreshold: number;
  criticalThreshold: number;
  direction: 'high' | 'low';
  enabled: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}
const schema = new Schema<TelemetryAlertRuleRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  metric: { type: String, enum: ['temperature_c','vibration_mm_s','pressure_bar','current_amp'], required: true },
  warningThreshold: { type: Number, required: true },
  criticalThreshold: { type: Number, required: true },
  direction: { type: String, enum: ['high','low'], required: true },
  enabled: { type: Boolean, default: true, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ tenantId: 1, metric: 1 }, { unique: true });
export const TelemetryAlertRule = model<TelemetryAlertRuleRecord>('TelemetryAlertRule', schema);
