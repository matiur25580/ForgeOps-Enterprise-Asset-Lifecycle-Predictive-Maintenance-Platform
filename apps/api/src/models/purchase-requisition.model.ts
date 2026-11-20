import { Schema, model, Types } from 'mongoose';
export type RequisitionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
export interface RequisitionLine { sparePartId: Types.ObjectId; description: string; quantity: number; estimatedUnitCost: number; }
export interface PurchaseRequisitionRecord {
 tenantId: Types.ObjectId; facilityId: Types.ObjectId; requisitionNumber: string;
 requestedBy: Types.ObjectId; status: RequisitionStatus; items: RequisitionLine[];
 justification: string; neededBy?: Date; submittedAt?: Date; approvedBy?: Types.ObjectId;
 approvedAt?: Date; rejectedBy?: Types.ObjectId; rejectedAt?: Date; rejectionReason?: string;
 createdBy: Types.ObjectId; updatedBy: Types.ObjectId;
}
const lineSchema = new Schema<RequisitionLine>({
 sparePartId:{type:Schema.Types.ObjectId,ref:'SparePart',required:true},
 description:{type:String,trim:true,required:true,maxlength:240},
 quantity:{type:Number,min:0.0001,required:true},
 estimatedUnitCost:{type:Number,min:0,required:true}
},{_id:false});
const schema = new Schema<PurchaseRequisitionRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 requisitionNumber:{type:String,required:true,trim:true,uppercase:true},
 requestedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 status:{type:String,enum:['draft','submitted','approved','rejected','ordered','partially_received','received','cancelled'],default:'draft',required:true},
 items:{type:[lineSchema],validate:{validator:(v:RequisitionLine[])=>v.length>0,message:'At least one line item is required.'}},
 justification:{type:String,trim:true,required:true,maxlength:2000},neededBy:{type:Date},
 submittedAt:{type:Date},approvedBy:{type:Schema.Types.ObjectId,ref:'User'},approvedAt:{type:Date},
 rejectedBy:{type:Schema.Types.ObjectId,ref:'User'},rejectedAt:{type:Date},rejectionReason:{type:String,trim:true,maxlength:1000},
 createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},updatedBy:{type:Schema.Types.ObjectId,ref:'User',required:true}
},{timestamps:true});
schema.index({tenantId:1,requisitionNumber:1},{unique:true});
schema.index({tenantId:1,facilityId:1,status:1,createdAt:-1});
export const PurchaseRequisition=model<PurchaseRequisitionRecord>('PurchaseRequisition',schema);
