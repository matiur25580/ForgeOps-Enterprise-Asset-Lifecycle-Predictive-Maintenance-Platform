import {Schema,model,Types} from 'mongoose';
export interface NotificationEscalationPolicyRecord{tenantId:Types.ObjectId;enabled:boolean;overdueAfterMinutes:number;notifyTenantAdmins:boolean;notifyFacilityManagers:boolean;}
const schema=new Schema<NotificationEscalationPolicyRecord>({tenantId:{type:Schema.Types.ObjectId,required:true,unique:true,index:true},enabled:{type:Boolean,default:true},overdueAfterMinutes:{type:Number,default:240,min:15,max:10080,required:true},notifyTenantAdmins:{type:Boolean,default:true},notifyFacilityManagers:{type:Boolean,default:true}},{timestamps:true});
export const NotificationEscalationPolicy=model<NotificationEscalationPolicyRecord>('NotificationEscalationPolicy',schema);
