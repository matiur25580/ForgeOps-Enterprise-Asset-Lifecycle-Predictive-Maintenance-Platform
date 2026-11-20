import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {WorkOrder} from '../models/work-order.model.js';
import {DowntimeEvent} from '../models/downtime-event.model.js';
import {Inspection} from '../models/inspection.model.js';
import {PurchaseOrder} from '../models/purchase-order.model.js';
import {toCsv} from '../utils/csv.js';
export const reportsRouter=Router();
reportsRouter.use(authenticate);
const claims=(req:Request):AccessClaims=>req.auth!;
const isAdmin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const names=['work-orders','downtime','inspections','purchase-orders'] as const;
type ReportName=typeof names[number];
function range(req:Request){
 const from=typeof req.query.from==='string'?new Date(req.query.from):new Date(Date.now()-30*86400000);
 const to=typeof req.query.to==='string'?new Date(req.query.to):new Date();
 if(typeof req.query.from==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.from))from.setUTCHours(0,0,0,0);
 if(typeof req.query.to==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.to))to.setUTCHours(23,59,59,999);
 if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to||to.getTime()-from.getTime()>366*86400000)return null;
 return {from,to};
}
reportsRouter.get('/catalog',(_req,res)=>res.status(200).json({data:{reports:[
 {id:'work-orders',title:'Work order register',dateField:'createdAt',description:'Status, priority, technician assignment and maintenance costs.'},
 {id:'downtime',title:'Downtime event register',dateField:'startedAt',description:'Downtime causes, resolution and independent verification.'},
 {id:'inspections',title:'Inspection compliance register',dateField:'performedAt',description:'Checklist outcomes, findings and review decisions.'},
 {id:'purchase-orders',title:'Purchase order register',dateField:'issuedAt',description:'Supplier commitments, currency and order value; excludes cancelled orders.'}
]}}));
reportsRouter.get('/exports/:report.csv',async(req,res,next)=>{
 try{
  const name=String(req.params.report??'') as ReportName;
  if(!names.includes(name)){res.status(404).json({error:{code:'REPORT_NOT_FOUND'}});return;}
  const period=range(req);if(!period){res.status(400).json({error:{code:'INVALID_DATE_RANGE',message:'Provide a valid date range no longer than 366 days.'}});return;}
  const c=claims(req);const filter:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
  if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(id=>new Types.ObjectId(id))};
  if(typeof req.query.facilityId==='string'){
   const id=req.query.facilityId;
   if(!Types.ObjectId.isValid(id)||(!isAdmin(c)&&!c.facilityIds.includes(id))){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
   filter.facilityId=new Types.ObjectId(id);
  }
  let headers:string[]=[];let rows:unknown[][]=[];
  if(name==='work-orders'){
   const docs=await WorkOrder.find({...filter,createdAt:{$gte:period.from,$lte:period.to}}).sort({createdAt:-1}).limit(10000).lean();
   headers=['workOrderNumber','title','type','status','priority','facilityId','assetId','assignedTo','dueAt','completedAt','actualHours','laborCost','externalServiceCost','costCurrency','createdAt'];
   rows=docs.map(x=>[x.workOrderNumber,x.title,x.type,x.status,x.priority,x.facilityId,x.assetId,x.assignedTo,x.dueAt,x.completedAt,x.actualHours,x.laborCost,x.externalServiceCost,x.costCurrency,x.createdAt]);
  }else if(name==='downtime'){
   const docs=await DowntimeEvent.find({...filter,startedAt:{$gte:period.from,$lte:period.to}}).sort({startedAt:-1}).limit(10000).lean();
   headers=['title','cause','status','verificationStatus','facilityId','assetId','workOrderId','startedAt','endedAt','reportedBy','verifiedBy','verificationNotes'];
   rows=docs.map(x=>[x.title,x.cause,x.status,x.verificationStatus,x.facilityId,x.assetId,x.workOrderId,x.startedAt,x.endedAt,x.reportedBy,x.verifiedBy,x.verificationNotes]);
  }else if(name==='inspections'){
   const docs=await Inspection.find({...filter,performedAt:{$gte:period.from,$lte:period.to}}).sort({performedAt:-1}).limit(10000).lean();
   headers=['inspectionNumber','templateCode','templateTitle','category','status','overallResult','findingsCount','reviewStatus','facilityId','assetId','performedAt','performedBy','reviewedAt','reviewedBy','reviewNotes'];
   rows=docs.map(x=>[x.inspectionNumber,x.templateSnapshot?.code,x.templateSnapshot?.title,x.templateSnapshot?.category,x.status,x.overallResult,x.findingsCount,x.reviewStatus,x.facilityId,x.assetId,x.performedAt,x.performedBy,x.reviewedAt,x.reviewedBy,x.reviewNotes]);
  }else{
   const docs=await PurchaseOrder.find({...filter,issuedAt:{$gte:period.from,$lte:period.to},status:{$ne:'cancelled'}}).sort({issuedAt:-1}).limit(10000).lean();
   headers=['purchaseOrderNumber','status','vendorId','facilityId','currency','subtotal','lineCount','expectedAt','issuedAt'];
   rows=docs.map(x=>[x.purchaseOrderNumber,x.status,x.vendorId,x.facilityId,x.currency,x.subtotal,x.items.length,x.expectedAt,x.issuedAt]);
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="forgeops-${name}-${period.from.toISOString().slice(0,10)}-to-${period.to.toISOString().slice(0,10)}.csv"`);
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Export-Row-Count',String(rows.length));
  res.status(200).send('\uFEFF'+toCsv(headers,rows));
 }catch(error){next(error);}
});
