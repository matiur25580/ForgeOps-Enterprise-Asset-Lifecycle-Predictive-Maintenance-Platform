import {Schema,model,Types} from 'mongoose';
export type NotificationCategory='sla'|'contract'|'asset_alert'|'maintenance';
export interface NotificationRecord{
 tenantId:Types.ObjectId;userId:Types.ObjectId;facilityId?:Types.ObjectId;category:NotificationCategory;
 title:string;message:string;severity:'info'|'warning'|'critical';resourceType:'work_order'|'vendor_contract'|'asset_alert'|'inspection';resourceId:Types.ObjectId;
 dedupeKey:string;readAt?:Date;createdAt?:Date;
}
const schema=new Schema<NotificationRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 userId:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility'},
 category:{type:String,enum:['sla','contract','asset_alert','maintenance'],required:true},
 title:{type:String,trim:true,required:true,maxlength:160},message:{type:String,trim:true,required:true,maxlength:500},
 severity:{type:String,enum:['info','warning','critical'],required:true},
 resourceType:{type:String,enum:['work_order','vendor_contract','asset_alert','inspection'],required:true},
 resourceId:{type:Schema.Types.ObjectId,required:true},dedupeKey:{type:String,required:true,maxlength:220},
 readAt:Date
},{timestamps:true});
schema.index({tenantId:1,userId:1,dedupeKey:1},{unique:true});
schema.index({tenantId:1,userId:1,readAt:1,createdAt:-1});
export const Notification=model<NotificationRecord>('Notification',schema);
