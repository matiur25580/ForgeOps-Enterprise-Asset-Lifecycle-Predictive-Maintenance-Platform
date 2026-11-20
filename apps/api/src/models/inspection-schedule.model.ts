import {Schema,model,Types} from 'mongoose';
export interface InspectionScheduleRecord{
 tenantId:Types.ObjectId;facilityId:Types.ObjectId;assetId:Types.ObjectId;templateId:Types.ObjectId;
 title:string;intervalDays:number;nextDueAt:Date;priority:'low'|'medium'|'high'|'emergency';
 assignedTo?:Types.ObjectId;status:'active'|'paused';lastGeneratedAt?:Date;createdBy:Types.ObjectId;updatedBy:Types.ObjectId;
}
const schema=new Schema<InspectionScheduleRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 assetId:{type:Schema.Types.ObjectId,ref:'Asset',required:true},
 templateId:{type:Schema.Types.ObjectId,ref:'InspectionTemplate',required:true},
 title:{type:String,required:true,trim:true,maxlength:160},
 intervalDays:{type:Number,required:true,min:1,max:3650},
 nextDueAt:{type:Date,required:true},
 priority:{type:String,enum:['low','medium','high','emergency'],default:'medium',required:true},
 assignedTo:{type:Schema.Types.ObjectId,ref:'User'},
 status:{type:String,enum:['active','paused'],default:'active',required:true},
 lastGeneratedAt:{type:Date},
 createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 updatedBy:{type:Schema.Types.ObjectId,ref:'User',required:true}
},{timestamps:true});
schema.index({tenantId:1,facilityId:1,status:1,nextDueAt:1});
schema.index({tenantId:1,assetId:1,templateId:1,status:1});
export const InspectionSchedule=model<InspectionScheduleRecord>('InspectionSchedule',schema);
