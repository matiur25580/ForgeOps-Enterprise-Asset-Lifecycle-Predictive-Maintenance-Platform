import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import {z} from 'zod';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {authorize} from '../middleware/authorize.js';
import {Vendor} from '../models/vendor.model.js';
import {VendorContract} from '../models/vendor-contract.model.js';
import {PurchaseOrder} from '../models/purchase-order.model.js';
import {GoodsReceipt} from '../models/goods-receipt.model.js';
import {AuditEvent} from '../models/audit-event.model.js';
export const vendorIntelligenceRouter=Router();vendorIntelligenceRouter.use(authenticate);
const cFor=(r:Request):AccessClaims=>r.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const manager=(c:AccessClaims)=>admin(c)||c.role==='manager';
const scope=(c:AccessClaims)=>admin(c)?{}:{facilityId:{$in:c.facilityIds.map(x=>new Types.ObjectId(x))}};
const bad=(res:any,code:string,status=400)=>res.status(status).json({error:{code}});
const contractInput=z.object({
 vendorId:z.string().refine(Types.ObjectId.isValid),contractNumber:z.string().trim().min(2).max(60),
 title:z.string().trim().min(2).max(180),contractType:z.enum(['supply','service','maintenance','framework']),
 startDate:z.coerce.date(),endDate:z.coerce.date(),renewalNoticeDays:z.number().int().min(0).max(730).default(90),
 autoRenew:z.boolean().default(false),annualValue:z.number().finite().nonnegative().max(1_000_000_000),
 currency:z.string().trim().regex(/^[A-Za-z]{3}$/),ownerUserId:z.string().refine(Types.ObjectId.isValid).optional(),
 notes:z.string().trim().max(2000).optional()
}).strict().superRefine((v,ctx)=>{if(v.endDate<=v.startDate)ctx.addIssue({code:z.ZodIssueCode.custom,message:'End date must be after start date.',path:['endDate']});});
const contractPatch=z.object({
 title:z.string().trim().min(2).max(180).optional(),contractType:z.enum(['supply','service','maintenance','framework']).optional(),
 startDate:z.coerce.date().optional(),endDate:z.coerce.date().optional(),renewalNoticeDays:z.number().int().min(0).max(730).optional(),
 autoRenew:z.boolean().optional(),annualValue:z.number().finite().nonnegative().max(1_000_000_000).optional(),
 currency:z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),ownerUserId:z.string().refine(Types.ObjectId.isValid).optional(),
 notes:z.string().trim().max(2000).optional(),status:z.enum(['draft','active','terminated']).optional()
}).strict();
async function audit(c:AccessClaims,entityId:Types.ObjectId,action:'created'|'updated',changes:Record<string,unknown>){
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),entityType:'vendor_contract',entityId,action,changes});
}
function dateFilter(req:Request){const from=typeof req.query.from==='string'?new Date(req.query.from):undefined;const to=typeof req.query.to==='string'?new Date(req.query.to):undefined;if((from&&!Number.isFinite(from.getTime()))||(to&&!Number.isFinite(to.getTime()))||(from&&to&&from>to))return null;if(to&&/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)))to.setUTCHours(23,59,59,999);return{from,to};}
vendorIntelligenceRouter.get('/scorecards',async(req,res,next)=>{
 try{const c=cFor(req),dates=dateFilter(req);if(!dates){bad(res,'INVALID_DATE_RANGE');return;}const match:any={tenantId:new Types.ObjectId(c.tenantId),...scope(c),status:{$ne:'cancelled'}};if(dates.from||dates.to)match.issuedAt={...(dates.from?{$gte:dates.from}:{}),...(dates.to?{$lte:dates.to}:{})};
 const orders=await PurchaseOrder.find(match).sort({issuedAt:-1}).limit(10000).lean();const vendorIds=[...new Set(orders.map(o=>o.vendorId.toString()))];const receipts=orders.length?await GoodsReceipt.find({tenantId:new Types.ObjectId(c.tenantId),purchaseOrderId:{$in:orders.map(o=>o._id)}}).lean():[];
 const vendors=vendorIds.length?await Vendor.find({tenantId:new Types.ObjectId(c.tenantId),_id:{$in:vendorIds}}).select('_id vendorCode name status').lean():[];
 const result=vendors.map(v=>{const os=orders.filter(o=>o.vendorId.toString()===v._id.toString());const vendorReceipts=receipts.filter(r=>r.vendorId.toString()===v._id.toString());const receivedUnits=vendorReceipts.flatMap(r=>r.items).reduce((s,x)=>s+x.quantityReceived,0);const acceptedUnits=vendorReceipts.flatMap(r=>r.items).filter(x=>x.condition==='accepted').reduce((s,x)=>s+x.quantityReceived,0);const eligible=os.filter(o=>o.status!=='cancelled');const complete=eligible.filter(o=>o.status==='received');const expected=complete.filter(o=>o.expectedAt);const onTime=expected.filter(o=>{const rs=receipts.filter(r=>r.purchaseOrderId.toString()===o._id.toString());const last=rs.reduce((d,r)=>Math.max(d,r.receivedAt.getTime()),0);return last>0&&last<=o.expectedAt!.getTime();}).length;const deliveryRate=expected.length?onTime/expected.length*100:null;const qualityRate=receivedUnits?acceptedUnits/receivedUnits*100:null;const fulfillmentRate=eligible.length?complete.length/eligible.length*100:null;const available=[{v:deliveryRate,w:0.4},{v:qualityRate,w:0.3},{v:fulfillmentRate,w:0.3}].filter(x=>x.v!==null);const score=available.length?available.reduce((s,x)=>s+x.v!*x.w,0)/available.reduce((s,x)=>s+x.w,0):null;return{vendor:v,metrics:{purchaseOrders:os.length,completedOrders:complete.length,onTimeOrders:onTime,ordersWithExpectedDate:expected.length,receivedUnits,acceptedUnits,deliveryRate:deliveryRate===null?null:Math.round(deliveryRate*10)/10,qualityAcceptanceRate:qualityRate===null?null:Math.round(qualityRate*10)/10,fulfillmentRate:fulfillmentRate===null?null:Math.round(fulfillmentRate*10)/10,score:score===null?null:Math.round(score*10)/10,scoreMethod:'Weighted available metrics: delivery 40%, quality acceptance 30%, order completion 30%; missing metric weights are excluded and remaining weights normalized.'}};}).sort((a,b)=>(b.metrics.score??-1)-(a.metrics.score??-1));
 res.status(200).json({data:{scorecards:result,period:{from:dates.from||null,to:dates.to||null},limitations:'On-time rate is calculated only for completed purchase orders with an expected date. Quality acceptance uses recorded receipt quantities. Scorecards are descriptive operational indicators, not audited supplier certifications; maximum 10,000 orders are evaluated.'}});
 }catch(e){next(e);}
});
vendorIntelligenceRouter.get('/spend',async(req,res,next)=>{
 try{const c=cFor(req),dates=dateFilter(req);if(!dates){bad(res,'INVALID_DATE_RANGE');return;}const match:any={tenantId:new Types.ObjectId(c.tenantId),...scope(c),status:{$ne:'cancelled'}};if(dates.from||dates.to)match.issuedAt={...(dates.from?{$gte:dates.from}:{}),...(dates.to?{$lte:dates.to}:{})};
 const orders=await PurchaseOrder.find(match).populate('vendorId','vendorCode name').populate('facilityId','code name').sort({issuedAt:-1}).limit(10000).lean();const groups=new Map<string,{currency:string,vendorId:string,vendorCode:string,vendorName:string,orderCount:number,committedAmount:number}>();const monthly=new Map<string,{month:string,currency:string,committedAmount:number,orderCount:number}>();
 for(const o of orders){const vendor=o.vendorId as any;const key=o.currency+'|'+vendor._id;const g=groups.get(key)||{currency:o.currency,vendorId:String(vendor._id),vendorCode:vendor.vendorCode,vendorName:vendor.name,orderCount:0,committedAmount:0};g.orderCount++;g.committedAmount+=o.subtotal;groups.set(key,g);const month=new Date(o.issuedAt).toISOString().slice(0,7);const mk=o.currency+'|'+month;const m=monthly.get(mk)||{month,currency:o.currency,committedAmount:0,orderCount:0};m.committedAmount+=o.subtotal;m.orderCount++;monthly.set(mk,m);}
 const currencies=new Map<string,{currency:string,committedAmount:number,orderCount:number}>();for(const o of orders){const v=currencies.get(o.currency)||{currency:o.currency,committedAmount:0,orderCount:0};v.committedAmount+=o.subtotal;v.orderCount++;currencies.set(o.currency,v);}
 const round=(n:number)=>Math.round(n*100)/100;res.status(200).json({data:{summaryByCurrency:[...currencies.values()].map(x=>({...x,committedAmount:round(x.committedAmount)})),byVendor:[...groups.values()].map(x=>({...x,committedAmount:round(x.committedAmount)})).sort((a,b)=>b.committedAmount-a.committedAmount),monthly:[...monthly.values()].map(x=>({...x,committedAmount:round(x.committedAmount)})).sort((a,b)=>a.month.localeCompare(b.month)||a.currency.localeCompare(b.currency)),purchaseOrderCount:orders.length,period:{from:dates.from||null,to:dates.to||null},basis:'Purchase-order subtotal at issue date; cancelled orders excluded. This is committed procurement value, not invoice-paid or cash-disbursed spend. Amounts are never converted across currencies.',truncated:orders.length===10000}});
 }catch(e){next(e);}
});
vendorIntelligenceRouter.get('/contracts/renewals',async(req,res,next)=>{
 try{const c=cFor(req);const days=typeof req.query.withinDays==='string'?Number(req.query.withinDays):90;if(!Number.isInteger(days)||days<0||days>730){bad(res,'INVALID_RENEWAL_WINDOW');return;}const now=new Date(),until=new Date(now.getTime()+days*86400000);const contracts=await VendorContract.find({tenantId:new Types.ObjectId(c.tenantId),status:'active',endDate:{$lte:until,$gte:now}}).populate('vendorId','vendorCode name').populate('ownerUserId','firstName lastName').sort({endDate:1}).limit(500).lean();res.status(200).json({data:{withinDays:days,contracts:contracts.map(x=>({...x,daysUntilExpiry:Math.ceil((x.endDate.getTime()-now.getTime())/86400000),renewalNoticeStarted:x.renewalNoticeDays>=Math.ceil((x.endDate.getTime()-now.getTime())/86400000)}))}});
 }catch(e){next(e);}
});
vendorIntelligenceRouter.get('/contracts',async(req,res,next)=>{
 try{const c=cFor(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(typeof req.query.vendorId==='string'){if(!Types.ObjectId.isValid(req.query.vendorId)){bad(res,'INVALID_VENDOR_ID');return;}filter.vendorId=new Types.ObjectId(req.query.vendorId);}const contracts=await VendorContract.find(filter).populate('vendorId','vendorCode name').populate('ownerUserId','firstName lastName').sort({endDate:1}).limit(500).lean();res.status(200).json({data:{contracts}});
 }catch(e){next(e);}
});
vendorIntelligenceRouter.post('/contracts',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=contractInput.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=cFor(req);const vendor=await Vendor.findOne({_id:p.data.vendorId,tenantId:c.tenantId}).select('_id');if(!vendor){bad(res,'VENDOR_NOT_FOUND',404);return;}const owner=p.data.ownerUserId||c.sub;const doc=await VendorContract.create({tenantId:new Types.ObjectId(c.tenantId),vendorId:new Types.ObjectId(p.data.vendorId),contractNumber:p.data.contractNumber,title:p.data.title,contractType:p.data.contractType,status:'active',startDate:p.data.startDate,endDate:p.data.endDate,renewalNoticeDays:p.data.renewalNoticeDays,autoRenew:p.data.autoRenew,annualValue:p.data.annualValue,currency:p.data.currency.toUpperCase(),ownerUserId:new Types.ObjectId(owner),notes:p.data.notes,createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub)});await audit(c,doc._id,'created',{vendorId:p.data.vendorId,contractNumber:doc.contractNumber,endDate:doc.endDate});res.status(201).json({data:{contract:doc}});
 }catch(e){next(e);}
});
vendorIntelligenceRouter.patch('/contracts/:id',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=contractPatch.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const id=req.params.id;if(typeof id!=='string'||!Types.ObjectId.isValid(id)){bad(res,'INVALID_CONTRACT_ID');return;}const c=cFor(req);const doc=await VendorContract.findOne({_id:id,tenantId:c.tenantId});if(!doc){bad(res,'CONTRACT_NOT_FOUND',404);return;}const start=p.data.startDate??doc.startDate,end=p.data.endDate??doc.endDate;if(end<=start){bad(res,'INVALID_CONTRACT_DATES');return;}if(p.data.status==='active'&&end<=new Date()){bad(res,'CANNOT_ACTIVATE_EXPIRED_CONTRACT',409);return;}Object.assign(doc,p.data,{...(p.data.ownerUserId?{ownerUserId:new Types.ObjectId(p.data.ownerUserId)}:{}),...(p.data.currency?{currency:p.data.currency.toUpperCase()}:{}),updatedBy:new Types.ObjectId(c.sub)});await doc.save();await audit(c,doc._id,'updated',{...p.data});res.status(200).json({data:{contract:doc}});
 }catch(e){next(e);}
});
