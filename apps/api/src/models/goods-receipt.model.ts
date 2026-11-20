import { Schema, model, Types } from 'mongoose';
export interface GoodsReceiptLine { sparePartId: Types.ObjectId; quantityReceived: number; condition: 'accepted' | 'damaged' | 'quarantined'; }
export interface GoodsReceiptRecord {
 tenantId: Types.ObjectId; facilityId: Types.ObjectId; receiptNumber: string;
 purchaseOrderId: Types.ObjectId; vendorId: Types.ObjectId; receivedBy: Types.ObjectId;
 items: GoodsReceiptLine[]; deliveryReference?: string; notes?: string; receivedAt: Date;
}
const lineSchema=new Schema<GoodsReceiptLine>({
 sparePartId:{type:Schema.Types.ObjectId,ref:'SparePart',required:true},
 quantityReceived:{type:Number,min:0.0001,required:true},
 condition:{type:String,enum:['accepted','damaged','quarantined'],default:'accepted',required:true}
},{_id:false});
const schema=new Schema<GoodsReceiptRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true,index:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 receiptNumber:{type:String,required:true,trim:true,uppercase:true},
 purchaseOrderId:{type:Schema.Types.ObjectId,ref:'PurchaseOrder',required:true},
 vendorId:{type:Schema.Types.ObjectId,ref:'Vendor',required:true},
 receivedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 items:{type:[lineSchema],validate:{validator:(v:GoodsReceiptLine[])=>v.length>0,message:'At least one receipt line is required.'}},
 deliveryReference:{type:String,trim:true,maxlength:120},notes:{type:String,trim:true,maxlength:2000},
 receivedAt:{type:Date,default:Date.now,required:true}
},{timestamps:false});
schema.index({tenantId:1,receiptNumber:1},{unique:true});
schema.index({tenantId:1,purchaseOrderId:1,receivedAt:-1});
export const GoodsReceipt=model<GoodsReceiptRecord>('GoodsReceipt',schema);
