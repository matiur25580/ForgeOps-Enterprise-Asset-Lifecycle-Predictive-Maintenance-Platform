import { Router, type Request } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { Facility } from '../models/facility.model.js';
import { WorkOrder } from '../models/work-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { SparePart } from '../models/spare-part.model.js';
import { InventoryBalance } from '../models/inventory-balance.model.js';
import { StockMovement } from '../models/stock-movement.model.js';
import { AuditEvent } from '../models/audit-event.model.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);
const id = (value: string): boolean => Types.ObjectId.isValid(value);
const partSchema = z.object({
  partNumber:z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9._-]+$/),
  name:z.string().trim().min(2).max(160), description:z.string().trim().max(2000).optional(),
  category:z.string().trim().min(2).max(80),
  unitOfMeasure:z.enum(['each','box','liter','kilogram','meter','set']).default('each'),
  manufacturer:z.string().trim().max(120).optional(), manufacturerPartNumber:z.string().trim().max(120).optional(),
  unitCost:z.number().finite().nonnegative(), currency:z.string().trim().length(3).default('USD'),
  preferredVendorId:z.string().refine(id).optional()
}).strict();
const vendorSchema = z.object({
  vendorCode:z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  name:z.string().trim().min(2).max(160), contactName:z.string().trim().max(120).optional(),
  email:z.string().email().max(254).optional(), phone:z.string().trim().max(40).optional(),
  website:z.string().url().max(240).optional(), paymentTerms:z.string().trim().max(80).optional(),
  notes:z.string().trim().max(2000).optional(),
  status:z.enum(['active','inactive','under_review']).default('active')
}).strict();
const movementSchema = z.object({
  facilityId:z.string().refine(id), sparePartId:z.string().refine(id),
  movementType:z.enum(['receipt','issue','adjustment']),
  quantity:z.number().finite().refine(v=>v!==0 && Math.abs(v)<=1_000_000),
  reason:z.string().trim().min(3).max(500),
  unitCost:z.number().finite().nonnegative().optional(),
  reference:z.string().trim().max(120).optional(),
  vendorId:z.string().refine(id).optional(),
  workOrderId:z.string().refine(id).optional(),
  reorderPoint:z.number().finite().min(0).optional(),
  binLocation:z.string().trim().max(80).optional()
}).strict();

function claimsFor(req:Request):AccessClaims{return req.auth!;}
function admin(c:AccessClaims):boolean{return c.role==='owner'||c.role==='admin';}
function inScope(c:AccessClaims,facilityId:string):boolean{return admin(c)||c.facilityIds.includes(facilityId);}
function bad(response:any,code:string,status=400):void{response.status(status).json({error:{code}});}

inventoryRouter.get('/vendors',authorize('owner','admin','manager','technician','viewer'),async(req,res,next)=>{
 try{const c=claimsFor(req);const status=typeof req.query.status==='string'&&['active','inactive','under_review'].includes(req.query.status)?req.query.status as 'active'|'inactive'|'under_review':undefined;const vendors=await Vendor.find({tenantId:c.tenantId,...(status?{status}:{})}).sort({name:1}).lean();res.status(200).json({data:{vendors}});}catch(e){next(e);}
});
inventoryRouter.post('/vendors',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const parsed=vendorSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claimsFor(req);const vendor=await Vendor.create({...parsed.data,tenantId:new Types.ObjectId(c.tenantId),createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub)});
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),entityType:'vendor',entityId:vendor._id,action:'created',changes:{fields:Object.keys(parsed.data)}});
 res.status(201).json({data:{vendor}});
 }catch(e){next(e);}
});
inventoryRouter.patch('/vendors/:vendorId',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const vendorId=req.params.vendorId;if(typeof vendorId!=='string'||!id(vendorId)){bad(res,'INVALID_VENDOR_ID');return;}
 const parsed=vendorSchema.partial().strict().refine(v=>Object.keys(v).length>0).safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claimsFor(req);const vendor=await Vendor.findOneAndUpdate({_id:vendorId,tenantId:c.tenantId},{$set:{...parsed.data,updatedBy:new Types.ObjectId(c.sub)}},{new:true,runValidators:true});
 if(!vendor){bad(res,'VENDOR_NOT_FOUND',404);return;}
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),entityType:'vendor',entityId:vendor._id,action:'updated',changes:{fields:Object.keys(parsed.data)}});
 res.status(200).json({data:{vendor}});
 }catch(e){next(e);}
});
inventoryRouter.get('/parts',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(req.query.active!=='all')filter.active=req.query.active!=='false';
 if(typeof req.query.q==='string'&&req.query.q.trim()){const q=req.query.q.trim().slice(0,80).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=[{partNumber:{$regex:q,$options:'i'}},{name:{$regex:q,$options:'i'}}];}
 const parts=await SparePart.find(filter).populate('preferredVendorId','vendorCode name').sort({partNumber:1}).lean();res.status(200).json({data:{parts}});
 }catch(e){next(e);}
});
inventoryRouter.post('/parts',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const parsed=partSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claimsFor(req);if(parsed.data.preferredVendorId&&!await Vendor.exists({_id:parsed.data.preferredVendorId,tenantId:c.tenantId,status:'active'})){bad(res,'VENDOR_NOT_FOUND',404);return;}
 const part=await SparePart.create({...parsed.data,preferredVendorId:parsed.data.preferredVendorId?new Types.ObjectId(parsed.data.preferredVendorId):undefined,tenantId:new Types.ObjectId(c.tenantId),createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub)});
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),entityType:'spare_part',entityId:part._id,action:'created',changes:{fields:Object.keys(parsed.data)}});
 res.status(201).json({data:{part}});
 }catch(e){next(e);}
});
inventoryRouter.get('/balances',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(typeof req.query.facilityId==='string'){if(!id(req.query.facilityId)||!inScope(c,req.query.facilityId)){bad(res,'FACILITY_NOT_FOUND',404);return;}filter.facilityId=new Types.ObjectId(req.query.facilityId);}else if(!admin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
 const balances=await InventoryBalance.find(filter).populate('facilityId','code name').populate('sparePartId','partNumber name category unitOfMeasure unitCost currency').sort({updatedAt:-1}).lean();
 res.status(200).json({data:{balances}});
 }catch(e){next(e);}
});
inventoryRouter.get('/movements',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(typeof req.query.facilityId==='string'){if(!id(req.query.facilityId)||!inScope(c,req.query.facilityId)){bad(res,'FACILITY_NOT_FOUND',404);return;}filter.facilityId=new Types.ObjectId(req.query.facilityId);}else if(!admin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
 const movements=await StockMovement.find(filter).populate('sparePartId','partNumber name').populate('facilityId','code name').populate('performedBy','firstName lastName').sort({occurredAt:-1}).limit(200).lean();
 res.status(200).json({data:{movements}});
 }catch(e){next(e);}
});
inventoryRouter.post('/movements',authorize('owner','admin','manager','technician'),async(req,res,next)=>{
 try{
 const parsed=movementSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claimsFor(req);const d=parsed.data;if(!inScope(c,d.facilityId)){bad(res,'FACILITY_SCOPE_FORBIDDEN',403);return;}
 const [facility,part,vendor,workOrder]=await Promise.all([
  Facility.findOne({_id:d.facilityId,tenantId:c.tenantId,status:'active'}).select('_id'),
  SparePart.findOne({_id:d.sparePartId,tenantId:c.tenantId,active:true}).select('_id unitCost'),
  d.vendorId?Vendor.findOne({_id:d.vendorId,tenantId:c.tenantId,status:'active'}).select('_id'):Promise.resolve(true),
  d.workOrderId?WorkOrder.findOne({_id:d.workOrderId,tenantId:c.tenantId,facilityId:d.facilityId}).select('_id'):Promise.resolve(true)
 ]);
 if(!facility){bad(res,'FACILITY_NOT_FOUND',404);return;}if(!part){bad(res,'SPARE_PART_NOT_FOUND',404);return;}
 if(d.vendorId&&!vendor){bad(res,'VENDOR_NOT_FOUND',404);return;}if(d.workOrderId&&!workOrder){bad(res,'WORK_ORDER_NOT_FOUND',404);return;}
 if(d.movementType==='receipt'&&d.quantity<0){bad(res,'RECEIPT_QUANTITY_MUST_BE_POSITIVE');return;}
 if(d.movementType==='issue'&&d.quantity<=0){bad(res,'ISSUE_QUANTITY_MUST_BE_POSITIVE');return;}
 if(d.movementType==='adjustment'&&d.quantity===0){bad(res,'ADJUSTMENT_CANNOT_BE_ZERO');return;}
 await InventoryBalance.updateOne({tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(d.facilityId),sparePartId:new Types.ObjectId(d.sparePartId)},{$setOnInsert:{onHand:0,reserved:0,reorderPoint:0,updatedBy:new Types.ObjectId(c.sub)}},{upsert:true});
 const filter:any={tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(d.facilityId),sparePartId:new Types.ObjectId(d.sparePartId)};
 if(d.movementType==='issue')filter.onHand={$gte:d.quantity};
 if(d.movementType==='adjustment'&&d.quantity<0)filter.onHand={$gte:Math.abs(d.quantity)};
 const delta=d.movementType==='adjustment'?d.quantity:(d.movementType==='receipt'?d.quantity:-d.quantity);
 const before=await InventoryBalance.findOne(filter).select('onHand');
 if(!before){bad(res,'INSUFFICIENT_STOCK',409);return;}
 const after=await InventoryBalance.findOneAndUpdate(filter,{$inc:{onHand:delta},$set:{updatedBy:new Types.ObjectId(c.sub),...(d.reorderPoint!==undefined?{reorderPoint:d.reorderPoint}:{}),...(d.binLocation!==undefined?{binLocation:d.binLocation}:{})}},{new:true});
 if(!after){bad(res,'INSUFFICIENT_STOCK',409);return;}
 try{
  const movement=await StockMovement.create({tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(d.facilityId),sparePartId:new Types.ObjectId(d.sparePartId),movementType:d.movementType,quantity:d.quantity,quantityBefore:before.onHand,quantityAfter:after.onHand,unitCost:d.unitCost??part.unitCost,reference:d.reference,reason:d.reason,workOrderId:d.workOrderId?new Types.ObjectId(d.workOrderId):undefined,vendorId:d.vendorId?new Types.ObjectId(d.vendorId):undefined,performedBy:new Types.ObjectId(c.sub)});
  await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:after.facilityId,entityType:'stock_movement',entityId:movement._id,action:'created',changes:{movementType:d.movementType,quantity:d.quantity,quantityBefore:before.onHand,quantityAfter:after.onHand}});
  res.status(201).json({data:{movement,balance:after}});
 }catch(error){
  await InventoryBalance.updateOne({_id:after._id},{$inc:{onHand:-delta}});
  throw error;
 }
 }catch(e){next(e);}
});
