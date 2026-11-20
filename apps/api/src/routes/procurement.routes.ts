import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { Facility } from '../models/facility.model.js';
import { Vendor } from '../models/vendor.model.js';
import { SparePart } from '../models/spare-part.model.js';
import { InventoryBalance } from '../models/inventory-balance.model.js';
import { StockMovement } from '../models/stock-movement.model.js';
import { PurchaseRequisition } from '../models/purchase-requisition.model.js';
import { PurchaseOrder } from '../models/purchase-order.model.js';
import { GoodsReceipt } from '../models/goods-receipt.model.js';
import { AuditEvent } from '../models/audit-event.model.js';

export const procurementRouter=Router();
procurementRouter.use(authenticate);
const validId=(v:string)=>Types.ObjectId.isValid(v);
const requisitionSchema=z.object({
 facilityId:z.string().refine(validId),
 items:z.array(z.object({sparePartId:z.string().refine(validId),quantity:z.number().finite().positive().max(1_000_000),estimatedUnitCost:z.number().finite().nonnegative()}).strict()).min(1).max(100),
 justification:z.string().trim().min(5).max(2000),neededBy:z.coerce.date().optional()
}).strict().superRefine((v,ctx)=>{const ids=v.items.map(x=>x.sparePartId);if(new Set(ids).size!==ids.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'A spare part may appear only once per requisition.',path:['items']});});
const rejectSchema=z.object({reason:z.string().trim().min(5).max(1000)}).strict();
const orderSchema=z.object({vendorId:z.string().refine(validId),expectedAt:z.coerce.date().optional(),notes:z.string().trim().max(2000).optional()}).strict();
const receiptSchema=z.object({
 items:z.array(z.object({sparePartId:z.string().refine(validId),quantityReceived:z.number().finite().positive().max(1_000_000),condition:z.enum(['accepted','damaged','quarantined']).default('accepted')}).strict()).min(1).max(100),
 deliveryReference:z.string().trim().max(120).optional(),notes:z.string().trim().max(2000).optional()
}).strict().superRefine((v,ctx)=>{const ids=v.items.map(x=>x.sparePartId);if(new Set(ids).size!==ids.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'A spare part may appear only once per receipt.',path:['items']});});
function claims(req:Request):AccessClaims{return req.auth!;}
function isAdmin(c:AccessClaims){return c.role==='owner'||c.role==='admin';}
function canManage(c:AccessClaims){return isAdmin(c)||c.role==='manager';}
function inScope(c:AccessClaims,facilityId:string){return isAdmin(c)||c.facilityIds.includes(facilityId);}
function fail(res:any,code:string,status=400){res.status(status).json({error:{code}});}
function number(prefix:string){return prefix+'-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+randomUUID().slice(0,6).toUpperCase();}
async function audit(c:AccessClaims,facilityId:Types.ObjectId,entityType:'purchase_requisition'|'purchase_order'|'goods_receipt',entityId:Types.ObjectId,action:'created'|'updated',changes:Record<string,unknown>){
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId,entityType,entityId,action,changes});
}

procurementRouter.get('/requisitions',async(req,res,next)=>{
 try{const c=claims(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};if(typeof req.query.status==='string')filter.status=req.query.status;
 const requisitions=await PurchaseRequisition.find(filter).populate('facilityId','code name').populate('requestedBy','firstName lastName').populate('items.sparePartId','partNumber name unitOfMeasure').sort({createdAt:-1}).limit(200).lean();res.status(200).json({data:{requisitions}});
 }catch(e){next(e);}
});
procurementRouter.post('/requisitions',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=requisitionSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claims(req);if(!inScope(c,p.data.facilityId)){fail(res,'FACILITY_SCOPE_FORBIDDEN',403);return;}
 const facility=await Facility.findOne({_id:p.data.facilityId,tenantId:c.tenantId,status:'active'}).select('_id');if(!facility){fail(res,'FACILITY_NOT_FOUND',404);return;}
 const ids=[...new Set(p.data.items.map(x=>x.sparePartId))];const parts=await SparePart.find({tenantId:c.tenantId,_id:{$in:ids},active:true}).select('_id name partNumber');if(parts.length!==ids.length){fail(res,'SPARE_PART_NOT_FOUND',404);return;}
 const byId=new Map(parts.map(x=>[x._id.toString(),x]));const items=p.data.items.map(x=>({sparePartId:new Types.ObjectId(x.sparePartId),description:byId.get(x.sparePartId)!.name,quantity:x.quantity,estimatedUnitCost:x.estimatedUnitCost}));
 const doc=await PurchaseRequisition.create({tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(p.data.facilityId),requisitionNumber:number('PR'),requestedBy:new Types.ObjectId(c.sub),status:'draft',items,justification:p.data.justification,neededBy:p.data.neededBy,createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub)});
 await audit(c,doc.facilityId,'purchase_requisition',doc._id,'created',{lineCount:items.length});res.status(201).json({data:{requisition:doc}});
 }catch(e){next(e);}
});
procurementRouter.post('/requisitions/:id/submit',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const c=claims(req),id=req.params.id;if(typeof id!=='string'||!validId(id)){fail(res,'INVALID_REQUISITION_ID');return;}const doc=await PurchaseRequisition.findOne({_id:id,tenantId:c.tenantId});if(!doc||!inScope(c,doc.facilityId.toString())){fail(res,'REQUISITION_NOT_FOUND',404);return;}if(doc.status!=='draft'){fail(res,'INVALID_REQUISITION_TRANSITION',409);return;}doc.status='submitted';doc.submittedAt=new Date();doc.updatedBy=new Types.ObjectId(c.sub);await doc.save();await audit(c,doc.facilityId,'purchase_requisition',doc._id,'updated',{status:'submitted'});res.status(200).json({data:{requisition:doc}});
 }catch(e){next(e);}
});
procurementRouter.post('/requisitions/:id/approve',authorize('owner','admin'),async(req,res,next)=>{
 try{const c=claims(req),id=req.params.id;if(typeof id!=='string'||!validId(id)){fail(res,'INVALID_REQUISITION_ID');return;}const doc=await PurchaseRequisition.findOne({_id:id,tenantId:c.tenantId});if(!doc||!inScope(c,doc.facilityId.toString())){fail(res,'REQUISITION_NOT_FOUND',404);return;}if(doc.status!=='submitted'){fail(res,'REQUISITION_NOT_SUBMITTED',409);return;}doc.status='approved';doc.approvedBy=new Types.ObjectId(c.sub);doc.approvedAt=new Date();doc.updatedBy=new Types.ObjectId(c.sub);await doc.save();await audit(c,doc.facilityId,'purchase_requisition',doc._id,'updated',{status:'approved'});res.status(200).json({data:{requisition:doc}});
 }catch(e){next(e);}
});
procurementRouter.post('/requisitions/:id/reject',authorize('owner','admin'),async(req,res,next)=>{
 try{const p=rejectSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claims(req),id=req.params.id;if(typeof id!=='string'||!validId(id)){fail(res,'INVALID_REQUISITION_ID');return;}const doc=await PurchaseRequisition.findOne({_id:id,tenantId:c.tenantId});if(!doc||!inScope(c,doc.facilityId.toString())){fail(res,'REQUISITION_NOT_FOUND',404);return;}if(doc.status!=='submitted'){fail(res,'REQUISITION_NOT_SUBMITTED',409);return;}doc.status='rejected';doc.rejectedBy=new Types.ObjectId(c.sub);doc.rejectedAt=new Date();doc.rejectionReason=p.data.reason;doc.updatedBy=new Types.ObjectId(c.sub);await doc.save();await audit(c,doc.facilityId,'purchase_requisition',doc._id,'updated',{status:'rejected',reason:p.data.reason});res.status(200).json({data:{requisition:doc}});
 }catch(e){next(e);}
});
procurementRouter.get('/purchase-orders',async(req,res,next)=>{
 try{const c=claims(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};if(typeof req.query.status==='string')filter.status=req.query.status;
 const orders=await PurchaseOrder.find(filter).populate('facilityId','code name').populate('vendorId','vendorCode name').populate('requisitionId','requisitionNumber').populate('items.sparePartId','partNumber name').sort({issuedAt:-1}).limit(200).lean();res.status(200).json({data:{purchaseOrders:orders}});
 }catch(e){next(e);}
});
procurementRouter.post('/requisitions/:id/purchase-order',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=orderSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claims(req),id=req.params.id;if(typeof id!=='string'||!validId(id)){fail(res,'INVALID_REQUISITION_ID');return;}const doc=await PurchaseRequisition.findOne({_id:id,tenantId:c.tenantId});if(!doc||!inScope(c,doc.facilityId.toString())){fail(res,'REQUISITION_NOT_FOUND',404);return;}if(doc.status!=='approved'){fail(res,'REQUISITION_MUST_BE_APPROVED',409);return;}
 const vendor=await Vendor.findOne({_id:p.data.vendorId,tenantId:c.tenantId,status:'active'}).select('_id');if(!vendor){fail(res,'VENDOR_NOT_FOUND',404);return;}
 const ids=doc.items.map(x=>x.sparePartId);const parts=await SparePart.find({_id:{$in:ids},tenantId:c.tenantId,active:true}).select('_id currency');if(parts.length!==new Set(ids.map(x=>x.toString())).size){fail(res,'SPARE_PART_NOT_FOUND',404);return;}const currencies=[...new Set(parts.map(x=>x.currency))];if(currencies.length!==1){fail(res,'MIXED_CURRENCY_REQUISITION',409);return;}
 const items=doc.items.map(x=>({sparePartId:x.sparePartId,description:x.description,orderedQuantity:x.quantity,receivedQuantity:0,unitCost:x.estimatedUnitCost}));const subtotal=items.reduce((s,x)=>s+x.orderedQuantity*x.unitCost,0);
 const order=await PurchaseOrder.create({tenantId:doc.tenantId,facilityId:doc.facilityId,purchaseOrderNumber:number('PO'),requisitionId:doc._id,vendorId:new Types.ObjectId(p.data.vendorId),status:'issued',items,currency:currencies[0],subtotal,expectedAt:p.data.expectedAt,issuedAt:new Date(),createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub),notes:p.data.notes});
 doc.status='ordered';doc.updatedBy=new Types.ObjectId(c.sub);await doc.save();await audit(c,doc.facilityId,'purchase_order',order._id,'created',{requisitionId:doc._id.toString(),subtotal,currency:order.currency});await audit(c,doc.facilityId,'purchase_requisition',doc._id,'updated',{status:'ordered'});res.status(201).json({data:{purchaseOrder:order,requisition:doc}});
 }catch(e){next(e);}
});
procurementRouter.get('/goods-receipts',async(req,res,next)=>{
 try{const c=claims(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};const receipts=await GoodsReceipt.find(filter).populate('purchaseOrderId','purchaseOrderNumber').populate('vendorId','vendorCode name').populate('facilityId','code name').populate('receivedBy','firstName lastName').populate('items.sparePartId','partNumber name').sort({receivedAt:-1}).limit(200).lean();res.status(200).json({data:{goodsReceipts:receipts}});
 }catch(e){next(e);}
});
procurementRouter.post('/purchase-orders/:id/receipts',authorize('owner','admin','manager','technician'),async(req,res,next)=>{
 try{const p=receiptSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claims(req),id=req.params.id;if(typeof id!=='string'||!validId(id)){fail(res,'INVALID_PURCHASE_ORDER_ID');return;}const order=await PurchaseOrder.findOne({_id:id,tenantId:c.tenantId});if(!order||!inScope(c,order.facilityId.toString())){fail(res,'PURCHASE_ORDER_NOT_FOUND',404);return;}if(order.status==='received'||order.status==='cancelled'){fail(res,'PURCHASE_ORDER_CLOSED',409);return;}
 const requested=new Map<string,number>();for(const line of p.data.items)requested.set(line.sparePartId,(requested.get(line.sparePartId)||0)+line.quantityReceived);
 for(const [partId,qty] of requested){const line=order.items.find(x=>x.sparePartId.toString()===partId);if(!line){fail(res,'PART_NOT_ON_PURCHASE_ORDER',400);return;}if(line.receivedQuantity+qty>line.orderedQuantity+1e-8){fail(res,'RECEIPT_EXCEEDS_ORDERED_QUANTITY',409);return;}}
 const parts=await SparePart.find({_id:{$in:[...requested.keys()]},tenantId:c.tenantId,active:true}).select('_id unitCost');if(parts.length!==requested.size){fail(res,'SPARE_PART_NOT_FOUND',404);return;}
 const receipt=await GoodsReceipt.create({tenantId:order.tenantId,facilityId:order.facilityId,receiptNumber:number('GRN'),purchaseOrderId:order._id,vendorId:order.vendorId,receivedBy:new Types.ObjectId(c.sub),items:p.data.items.map(x=>({...x,sparePartId:new Types.ObjectId(x.sparePartId)})),deliveryReference:p.data.deliveryReference,notes:p.data.notes,receivedAt:new Date()});
 for(const [partId,qty] of requested){const line=order.items.find(x=>x.sparePartId.toString()===partId)!;line.receivedQuantity+=qty;}
 const complete=order.items.every(x=>x.receivedQuantity>=x.orderedQuantity-1e-8);order.status=complete?'received':'partially_received';order.updatedBy=new Types.ObjectId(c.sub);await order.save();
 for(const item of p.data.items){if(item.condition!=='accepted')continue;const part=parts.find(x=>x._id.toString()===item.sparePartId)!;const key={tenantId:order.tenantId,facilityId:order.facilityId,sparePartId:new Types.ObjectId(item.sparePartId)};
  try{await InventoryBalance.updateOne(key,{$setOnInsert:{onHand:0,reserved:0,reorderPoint:0,updatedBy:new Types.ObjectId(c.sub)}},{upsert:true});}catch(e){if(!(typeof e==='object'&&e!==null&&'code'in e&&e.code===11000))throw e;}
  const balance=await InventoryBalance.findOneAndUpdate(key,{$inc:{onHand:item.quantityReceived},$set:{updatedBy:new Types.ObjectId(c.sub)}},{new:true});if(!balance)throw new Error('Unable to update inventory balance for received goods.');
  await StockMovement.create({tenantId:order.tenantId,facilityId:order.facilityId,sparePartId:new Types.ObjectId(item.sparePartId),movementType:'receipt',quantity:item.quantityReceived,quantityBefore:balance.onHand-item.quantityReceived,quantityAfter:balance.onHand,unitCost:lineCost(order,item.sparePartId),reference:receipt.receiptNumber,reason:'Goods received against purchase order '+order.purchaseOrderNumber,vendorId:order.vendorId,performedBy:new Types.ObjectId(c.sub)});
 }
 const requisition=await PurchaseRequisition.findOne({_id:order.requisitionId,tenantId:c.tenantId});if(requisition){requisition.status=complete?'received':'partially_received';requisition.updatedBy=new Types.ObjectId(c.sub);await requisition.save();}
 await audit(c,order.facilityId,'goods_receipt',receipt._id,'created',{purchaseOrderId:order._id.toString(),acceptedLineCount:p.data.items.filter(x=>x.condition==='accepted').length});await audit(c,order.facilityId,'purchase_order',order._id,'updated',{status:order.status});res.status(201).json({data:{goodsReceipt:receipt,purchaseOrder:order}});
 }catch(e){next(e);}
});
function lineCost(order:{items:Array<{sparePartId:Types.ObjectId;unitCost:number}>},partId:string){return order.items.find(x=>x.sparePartId.toString()===partId)?.unitCost??0;}
