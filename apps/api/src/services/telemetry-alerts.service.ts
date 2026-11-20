import { Types } from 'mongoose';
import { AssetAlert } from '../models/asset-alert.model.js';
import { TelemetryAlertRule } from '../models/telemetry-alert-rule.model.js';
import type { TelemetryMetric } from '../models/telemetry-reading.model.js';

const defaults: Record<TelemetryMetric, { warning: number; critical: number; direction: 'high' | 'low' }> = {
  temperature_c: { warning: 75, critical: 90, direction: 'high' },
  vibration_mm_s: { warning: 4.5, critical: 7.1, direction: 'high' },
  pressure_bar: { warning: 2, critical: 1, direction: 'low' },
  current_amp: { warning: 80, critical: 100, direction: 'high' }
};
export function severityFor(metric: TelemetryMetric, value: number, rule: { warningThreshold: number; criticalThreshold: number; direction: 'high'|'low' }): 'warning'|'critical'|null {
  if (rule.direction === 'high') return value >= rule.criticalThreshold ? 'critical' : value >= rule.warningThreshold ? 'warning' : null;
  return value <= rule.criticalThreshold ? 'critical' : value <= rule.warningThreshold ? 'warning' : null;
}
export async function evaluateTelemetryAlerts(readings: Array<{tenantId: Types.ObjectId; facilityId: Types.ObjectId; assetId: Types.ObjectId; metric: TelemetryMetric; value: number; unit: string; recordedAt: Date}>) {
  let created = 0; let refreshed = 0;
  const ruleCache = new Map<string, {warningThreshold:number;criticalThreshold:number;direction:'high'|'low';enabled:boolean}>();
  for (const reading of readings) {
    const key = reading.tenantId.toString() + ':' + reading.metric;
    let rule = ruleCache.get(key);
    if (!rule) {
      const configured = await TelemetryAlertRule.findOne({tenantId:reading.tenantId,metric:reading.metric}).lean();
      const fallback = defaults[reading.metric];
      rule = configured ? {warningThreshold:configured.warningThreshold,criticalThreshold:configured.criticalThreshold,direction:configured.direction,enabled:configured.enabled} : {...fallback,enabled:true};
      ruleCache.set(key,rule);
    }
    if (!rule.enabled) continue;
    const severity = severityFor(reading.metric,reading.value,rule);
    if (!severity) continue;
    const message = reading.metric + ' measured ' + reading.value + ' ' + reading.unit + ' (' + severity + ')';
    const active = await AssetAlert.findOneAndUpdate(
      {tenantId:reading.tenantId,assetId:reading.assetId,metric:reading.metric,status:{$in:['open','acknowledged']}},
      {$set:{value:reading.value,unit:reading.unit,severity,message,lastTriggeredAt:reading.recordedAt}},
      {new:true}
    );
    if (active) { refreshed++; continue; }
    await AssetAlert.create({
      tenantId:reading.tenantId,facilityId:reading.facilityId,assetId:reading.assetId,
      metric:reading.metric,value:reading.value,unit:reading.unit,severity,status:'open',
      message,firstTriggeredAt:reading.recordedAt,lastTriggeredAt:reading.recordedAt
    });
    created++;
  }
  return {created,refreshed};
}
