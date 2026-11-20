import {Schema,model,Types} from 'mongoose';
export type DowntimeCause='breakdown'|'planned_maintenance'|'inspection'|'utility_outage'|'other';
export type DowntimeStatus='open'|'resolved';
export type DowntimeVerification='pending'|'verified'|'rejected';
export interface DowntimeEventRecord{
 tenantId:Types.ObjectId;facilityId:Types.ObjectId;assetId:Types.ObjectId;workOrderId?:Types.ObjectId;
 cause:DowntimeCause;title:string;description?:string;startedAt:Date;endedAt?:Date;
 status:DowntimeStatus;verificationStatus:DowntimeVerification;verificationNotes?:string;
 reportedBy:Types.ObjectId;resolvedBy?:Types.ObjectId;verifiedBy?:Types.ObjectId;verifiedAt?:Date;
 createdAt?:Date;updatedAt?:Date;
}
const schema=new Schema<DowntimeEventRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 assetId:{type:Schema.Types.ObjectId,ref:'Asset',required:true},
 workOrderId:{type:Schema.Types.ObjectId,ref:'WorkOrder'},
 cause:{type:String,enum:['breakdown','planned_maintenance','inspection','utility_outage','other'],required:true},
 title:{type:String,trim:true,minlength:3,maxlength:160,required:true},
 description:{type:String,trim:true,maxlength:2000},
 startedAt:{type:Date,required:true},endedAt:{type:Date},
 status:{type:String,enum:['open','resolved'],default:'open',required:true},
 verificationStatus:{type:String,enum:['pending','verified','rejected'],default:'pending',required:true},
 verificationNotes:{type:String,trim:true,maxlength:1000},
 reportedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 resolvedBy:{type:Schema.Types.ObjectId,ref:'User'},
 verifiedBy:{type:Schema.Types.ObjectId,ref:'User'},verifiedAt:{type:Date}
},{timestamps:true});
schema.index({tenantId:1,facilityId:1,assetId:1,startedAt:-1});
schema.index({tenantId:1,assetId:1,status:1});
schema.index({tenantId:1,assetId:1},{unique:true,partialFilterExpression:{status:'open'}});
schema.index({tenantId:1,verificationStatus:1,startedAt:-1});
export const DowntimeEvent=model<DowntimeEventRecord>('DowntimeEvent',schema);
