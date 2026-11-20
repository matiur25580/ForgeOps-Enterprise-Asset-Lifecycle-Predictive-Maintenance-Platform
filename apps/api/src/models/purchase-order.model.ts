import { Schema, model, Types } from 'mongoose';
export type PurchaseOrderStatus = 'issued' | 'partially_received' | 'received' | 'cancelled';
export interface PurchaseOrderLine { sparePartId: Types.ObjectId; description: string; orderedQuantity: number; receivedQuantity: number; unitCost: number; }
export interface PurchaseOrderRecord {
 tenantId: Types.ObjectId; facilityId: Types.ObjectId; purchaseOrderNumber: string;
 requisitionId: Types.ObjectId; vendorId: Types.ObjectId; status: PurchaseOrderStatus;
 items: PurchaseOrderLine[]; currency: string; subtotal: number; expectedAt?: Date;
 issuedAt: Date; createdBy: Types.ObjectId; updatedBy: Types.ObjectId; notes?: string;
}
const lineSchema=new Schema<PurchaseOrderLine>({
 sparePartId:{type:Schema.Types.ObjectId,ref:'SparePart',required:true},
 description:{type:String,trim:true,required:true,maxlength:240},
 orderedQuantity:{type:Number,min:0.0001,required:true},receivedQuantity:{type:Number,min:0,default:0,required:true},
 unitCost:{type:Number,min:0,required:true}
},{_id:false});
const schema=new Schema<PurchaseOrderRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 purchaseOrderNumber:{type:String,required:true,trim:true,uppercase:true},
 requisitionId:{type:Schema.Types.ObjectId,ref:'PurchaseRequisition',required:true},
 vendorId:{type:Schema.Types.ObjectId,ref:'Vendor',required:true},
 status:{type:String,enum:['issued','partially_received','received','cancelled'],default:'issued',required:true},
 items:{type:[lineSchema],validate:{validator:(v:PurchaseOrderLine[])=>v.length>0,message:'At least one line item is required.'}},
 currency:{type:String,uppercase:true,minlength:3,maxlength:3,required:true},
 subtotal:{type:Number,min:0,required:true},expectedAt:{type:Date},issuedAt:{type:Date,default:Date.now,required:true},
 createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},updatedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 notes:{type:String,trim:true,maxlength:2000}
},{timestamps:true});
schema.index({tenantId:1,purchaseOrderNumber:1},{unique:true});
schema.index({tenantId:1,facilityId:1,status:1,createdAt:-1});
schema.index({tenantId:1,requisitionId:1},{unique:true});
export const PurchaseOrder=model<PurchaseOrderRecord>('PurchaseOrder',schema);
