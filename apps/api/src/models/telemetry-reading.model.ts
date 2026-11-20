import { Schema, model, Types } from 'mongoose';

export type TelemetryMetric = 'temperature_c' | 'vibration_mm_s' | 'pressure_bar' | 'current_amp';
export interface TelemetryReadingRecord {
  tenantId: Types.ObjectId; facilityId: Types.ObjectId; assetId: Types.ObjectId;
  metric: TelemetryMetric; value: number; unit: string; quality: 'good'|'suspect';
  source: 'simulator'|'device'; recordedAt: Date;
}
const schema = new Schema<TelemetryReadingRecord>({
  tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
  facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true,index:true},
  assetId:{type:Schema.Types.ObjectId,ref:'Asset',required:true,index:true},
  metric:{type:String,enum:['temperature_c','vibration_mm_s','pressure_bar','current_amp'],required:true},
  value:{type:Number,required:true,min:0},unit:{type:String,required:true},
  quality:{type:String,enum:['good','suspect'],default:'good'},
  source:{type:String,enum:['simulator','device'],default:'simulator'},
  recordedAt:{type:Date,required:true,index:true}
},{timestamps:true});
schema.index({tenantId:1,assetId:1,metric:1,recordedAt:-1});
export const TelemetryReading=model<TelemetryReadingRecord>('TelemetryReading',schema);
