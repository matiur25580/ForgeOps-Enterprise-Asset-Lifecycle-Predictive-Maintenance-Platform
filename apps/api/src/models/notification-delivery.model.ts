import {Schema,model,Types} from 'mongoose';
export interface NotificationDeliveryRecord{tenantId:Types.ObjectId;notificationId:Types.ObjectId;userId:Types.ObjectId;channel:'email';status:'queued'|'sent'|'failed'|'skipped';attempts:number;recipient:string;providerMessageId?:string;lastError?:string;sentAt?:Date;createdAt?:Date;updatedAt?:Date;}
const schema=new Schema<NotificationDeliveryRecord>({tenantId:{type:Schema.Types.ObjectId,required:true,index:true},notificationId:{type:Schema.Types.ObjectId,required:true,ref:'Notification'},userId:{type:Schema.Types.ObjectId,required:true,ref:'User'},channel:{type:String,enum:['email'],required:true},status:{type:String,enum:['queued','sent','failed','skipped'],default:'queued',required:true},attempts:{type:Number,default:0,min:0},recipient:{type:String,required:true,lowercase:true,trim:true},providerMessageId:String,lastError:{type:String,maxlength:1000},sentAt:Date},{timestamps:true});
schema.index({tenantId:1,notificationId:1,channel:1},{unique:true});
schema.index({tenantId:1,userId:1,createdAt:-1});
export const NotificationDelivery=model<NotificationDeliveryRecord>('NotificationDelivery',schema);
