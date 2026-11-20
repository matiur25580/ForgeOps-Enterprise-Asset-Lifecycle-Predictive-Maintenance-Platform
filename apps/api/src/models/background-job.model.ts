import {Schema,model,Types} from 'mongoose';
export type BackgroundJobType='operations_scan'|'notification_email';
export type BackgroundJobStatus='queued'|'running'|'completed'|'failed';
export interface BackgroundJobRecord{
 tenantId:Types.ObjectId;type:BackgroundJobType;status:BackgroundJobStatus;
 payload:{facilityIds?:Types.ObjectId[];requestedBy?:Types.ObjectId;notificationId?:Types.ObjectId;};
 dedupeKey:string;attempts:number;maxAttempts:number;availableAt:Date;
 lockedAt?:Date;lockExpiresAt?:Date;lockedBy?:string;lastError?:string;
 startedAt?:Date;completedAt?:Date;createdAt?:Date;updatedAt?:Date;
}
const schema=new Schema<BackgroundJobRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 type:{type:String,enum:['operations_scan','notification_email'],required:true},
 status:{type:String,enum:['queued','running','completed','failed'],default:'queued',required:true,index:true},
 payload:{facilityIds:[{type:Schema.Types.ObjectId,ref:'Facility'}],requestedBy:{type:Schema.Types.ObjectId,ref:'User'},notificationId:{type:Schema.Types.ObjectId,ref:'Notification'}},
 dedupeKey:{type:String,required:true,maxlength:220},
 attempts:{type:Number,default:0,min:0,required:true},maxAttempts:{type:Number,default:5,min:1,max:20,required:true},
 availableAt:{type:Date,default:Date.now,required:true,index:true},lockedAt:Date,lockExpiresAt:Date,lockedBy:String,
 lastError:{type:String,maxlength:2000},startedAt:Date,completedAt:Date
},{timestamps:true});
schema.index({tenantId:1,dedupeKey:1},{unique:true});
schema.index({status:1,availableAt:1,createdAt:1});
schema.index({status:1,lockExpiresAt:1});
export const BackgroundJob=model<BackgroundJobRecord>('BackgroundJob',schema);
