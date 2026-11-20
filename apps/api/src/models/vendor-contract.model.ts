import {Schema,model,Types} from 'mongoose';
export type VendorContractStatus='draft'|'active'|'expired'|'terminated';
export interface VendorContractRecord{
 tenantId:Types.ObjectId;vendorId:Types.ObjectId;contractNumber:string;title:string;contractType:'supply'|'service'|'maintenance'|'framework';
 status:VendorContractStatus;startDate:Date;endDate:Date;renewalNoticeDays:number;autoRenew:boolean;annualValue:number;currency:string;
 ownerUserId:Types.ObjectId;notes?:string;createdBy:Types.ObjectId;updatedBy:Types.ObjectId;renewedFromContractId?:Types.ObjectId;
}
const schema=new Schema<VendorContractRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},vendorId:{type:Schema.Types.ObjectId,ref:'Vendor',required:true,index:true},
 contractNumber:{type:String,trim:true,uppercase:true,required:true,maxlength:60},title:{type:String,trim:true,required:true,maxlength:180},
 contractType:{type:String,enum:['supply','service','maintenance','framework'],required:true},
 status:{type:String,enum:['draft','active','expired','terminated'],default:'draft',required:true},
 startDate:{type:Date,required:true},endDate:{type:Date,required:true},renewalNoticeDays:{type:Number,min:0,max:730,default:90,required:true},
 autoRenew:{type:Boolean,default:false,required:true},annualValue:{type:Number,min:0,required:true},currency:{type:String,uppercase:true,minlength:3,maxlength:3,required:true},
 ownerUserId:{type:Schema.Types.ObjectId,ref:'User',required:true},notes:{type:String,trim:true,maxlength:2000},
 createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},updatedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 renewedFromContractId:{type:Schema.Types.ObjectId,ref:'VendorContract'}
},{timestamps:true,optimisticConcurrency:true});
schema.index({tenantId:1,contractNumber:1},{unique:true});
schema.index({tenantId:1,vendorId:1,status:1,endDate:1});
export const VendorContract=model<VendorContractRecord>('VendorContract',schema);
