import { Router,type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { Facility } from '../models/facility.model.js';
import { Asset } from '../models/asset.model.js';
import { InspectionTemplate } from '../models/inspection-template.model.js';
import { Inspection } from '../models/inspection.model.js';
import { InspectionSchedule } from '../models/inspection-schedule.model.js';
import { WorkOrder } from '../models/work-order.model.js';
import { AuditEvent } from '../models/audit-event.model.js';

export const inspectionsRouter=Router();
inspectionsRouter.use(authenticate);
const claimsFor=(r:Request):AccessClaims=>r.auth!;
const isAdmin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const isManager=(c:AccessClaims)=>isAdmin(c)||c.role==='manager';
const inScope=(c:AccessClaims,id:string)=>isAdmin(c)||c.facilityIds.includes(id);
const oid=(v:string)=>Types.ObjectId.isValid(v);
const templateSchema=z.object({
 facilityId:z.string().refine(oid).optional(),code:z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9_-]+$/),
 title:z.string().trim().min(3).max(160),description:z.string().trim().max(2000).optional(),
 category:z.enum(['safety','condition','compliance','environmental','quality','other']),
 items:z.array(z.object({key:z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9_-]+$/),label:z.string().trim().min(3).max(180),guidance:z.string().trim().max(500).optional(),required:z.boolean().default(true)}).strict()).min(1).max(60)
}).strict();
const executionSchema=z.object({
 facilityId:z.string().refine(oid),assetId:z.string().refine(oid),templateId:z.string().refine(oid),
 responses:z.array(z.object({itemKey:z.string().min(1).max(40),result:z.enum(['pass','fail','not_applicable']),notes:z.string().trim().max(2000).optional(),evidenceReference:z.string().trim().max(500).optional()}).strict()).min(1).max(60),
 performedAt:z.coerce.date().optional()
}).strict();

inspectionsRouter.get('/templates',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:Record<string,unknown>={tenantId:c.tenantId,active:true};
 if(!isAdmin(c))filter.$or=[{facilityId:{$exists:false}},{facilityId:null},{facilityId:{$in:c.facilityIds.map(x=>new Types.ObjectId(x))}}];
 const templates=await InspectionTemplate.find(filter).sort({category:1,title:1}).lean();res.status(200).json({data:{templates}});
 }catch(e){next(e);}
});
inspectionsRouter.post('/templates',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=templateSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}
 const c=claimsFor(req);if(p.data.facilityId&&!inScope(c,p.data.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
 const keys=p.data.items.map(x=>x.key.toLowerCase());if(new Set(keys).size!==keys.length){res.status(400).json({error:{code:'DUPLICATE_CHECKLIST_ITEM_KEY'}});return;}
 if(p.data.facilityId&&!await Facility.exists({_id:p.data.facilityId,tenantId:c.tenantId,status:'active'})){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
 const userId=new Types.ObjectId(c.sub);const template=await InspectionTemplate.create({...p.data,tenantId:new Types.ObjectId(c.tenantId),facilityId:p.data.facilityId?new Types.ObjectId(p.data.facilityId):undefined,createdBy:userId,updatedBy:userId});
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:userId,facilityId:template.facilityId,entityType:'inspection_template',entityId:template._id,action:'created',changes:{code:template.code,itemCount:template.items.length}});
 res.status(201).json({data:{template}});
 }catch(e){next(e);}
});
inspectionsRouter.post('/',authorize('owner','admin','manager','technician'),async(req,res,next)=>{
 try{const p=executionSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}
 const c=claimsFor(req);if(!inScope(c,p.data.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
 const [facility,asset,template]=await Promise.all([
 Facility.findOne({_id:p.data.facilityId,tenantId:c.tenantId,status:'active'}).select('_id'),
 Asset.findOne({_id:p.data.assetId,tenantId:c.tenantId,facilityId:p.data.facilityId,archivedAt:null}).select('_id assetTag name'),
 InspectionTemplate.findOne({_id:p.data.templateId,tenantId:c.tenantId,active:true,$or:[{facilityId:{$exists:false}},{facilityId:null},{facilityId:p.data.facilityId}]})
 ]);
 if(!facility){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
 if(!asset){res.status(404).json({error:{code:'ASSET_NOT_FOUND'}});return;}
 if(!template){res.status(404).json({error:{code:'INSPECTION_TEMPLATE_NOT_FOUND'}});return;}
 const expected=new Map(template.items.map(i=>[i.key,i]));const supplied=new Set<string>();
 for(const response of p.data.responses){if(!expected.has(response.itemKey)||supplied.has(response.itemKey)){res.status(400).json({error:{code:'INVALID_CHECKLIST_RESPONSE',message:'Unknown or duplicate checklist item.'}});return;}supplied.add(response.itemKey);if(response.result==='fail'&&!response.notes){res.status(400).json({error:{code:'FINDING_NOTES_REQUIRED',message:'Every failed item requires finding notes.'}});return;}}
 for(const item of template.items){if(item.required&&!supplied.has(item.key)){res.status(400).json({error:{code:'REQUIRED_CHECKLIST_ITEM_MISSING',itemKey:item.key}});return;}}
 const failures=p.data.responses.filter(x=>x.result==='fail');const userId=new Types.ObjectId(c.sub);
 const inspection=await Inspection.create({
 tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(p.data.facilityId),assetId:new Types.ObjectId(p.data.assetId),templateId:template._id,
 templateSnapshot:{code:template.code,title:template.title,category:template.category,items:template.items.map(i=>({key:i.key,label:i.label,required:i.required}))},
 inspectionNumber:'INSP-'+Date.now().toString(36).toUpperCase()+'-'+randomUUID().slice(0,6).toUpperCase(),
 status:'completed',responses:p.data.responses,overallResult:failures.length?'fail':'pass',findingsCount:failures.length,reviewStatus:'pending',
 performedBy:userId,performedAt:p.data.performedAt||new Date()
 });
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:userId,facilityId:inspection.facilityId,entityType:'inspection',entityId:inspection._id,action:'created',changes:{overallResult:inspection.overallResult,findingsCount:inspection.findingsCount,templateCode:template.code}});
 res.status(201).json({data:{inspection}});
 }catch(e){next(e);}
});
inspectionsRouter.get('/',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
 if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
 if(typeof req.query.facilityId==='string'){if(!oid(req.query.facilityId)||!inScope(c,req.query.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}filter.facilityId=new Types.ObjectId(req.query.facilityId);}
 if(typeof req.query.result==='string'&&['pass','fail'].includes(req.query.result))filter.overallResult=req.query.result;
 const inspections=await Inspection.find(filter).populate('assetId','assetTag name').populate('facilityId','code name').populate('performedBy','firstName lastName').populate('correctiveWorkOrderId','workOrderNumber status').sort({performedAt:-1}).limit(200).lean();
 const summary={total:inspections.length,passed:inspections.filter(i=>i.overallResult==='pass').length,failed:inspections.filter(i=>i.overallResult==='fail').length,findings:inspections.reduce((n,i)=>n+i.findingsCount,0)};
 res.status(200).json({data:{inspections,summary}});
 }catch(e){next(e);}
});
inspectionsRouter.post('/:inspectionId/corrective-work-order',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const c=claimsFor(req);const id=String(req.params.inspectionId ?? '');if(!oid(id)){res.status(400).json({error:{code:'INVALID_INSPECTION_ID'}});return;}
 const inspection=await Inspection.findOne({_id:id,tenantId:c.tenantId});if(!inspection||!inScope(c,inspection.facilityId.toString())){res.status(404).json({error:{code:'INSPECTION_NOT_FOUND'}});return;}
 if(!inspection.findingsCount){res.status(409).json({error:{code:'NO_FAILED_FINDINGS'}});return;}
 if(inspection.correctiveWorkOrderId){const existing=await WorkOrder.findOne({_id:inspection.correctiveWorkOrderId,tenantId:c.tenantId});if(existing){res.status(200).json({data:{workOrder:existing,alreadyLinked:true}});return;}}
 const asset=await Asset.findOne({_id:inspection.assetId,tenantId:c.tenantId,facilityId:inspection.facilityId,archivedAt:null}).select('_id');
 if(!asset){res.status(409).json({error:{code:'INSPECTION_ASSET_UNAVAILABLE'}});return;}
 const failed=inspection.responses.filter(r=>r.result==='fail').map(r=>{const item=inspection.templateSnapshot.items.find(i=>i.key===r.itemKey);return (item?.label||r.itemKey)+': '+(r.notes||'Finding recorded');});
 const userId=new Types.ObjectId(c.sub);
 const workOrder=await WorkOrder.create({tenantId:inspection.tenantId,facilityId:inspection.facilityId,assetId:inspection.assetId,workOrderNumber:'INSP-'+Date.now().toString(36).toUpperCase()+'-'+randomUUID().slice(0,6).toUpperCase(),title:'Corrective action: '+inspection.templateSnapshot.title,description:failed.join('\n').slice(0,4000),type:'corrective',status:'open',priority:'high',sourceInspectionId:inspection._id,createdBy:userId,updatedBy:userId});
 inspection.correctiveWorkOrderId=workOrder._id;await inspection.save();
 await AuditEvent.create({tenantId:inspection.tenantId,actorUserId:userId,facilityId:inspection.facilityId,entityType:'inspection',entityId:inspection._id,action:'updated',changes:{correctiveWorkOrderId:workOrder._id}});
 res.status(201).json({data:{workOrder,alreadyLinked:false}});
 }catch(e){next(e);}
});

const scheduleSchema=z.object({facilityId:z.string().refine(oid),assetId:z.string().refine(oid),templateId:z.string().refine(oid),title:z.string().trim().min(3).max(160),intervalDays:z.number().int().min(1).max(3650),nextDueAt:z.coerce.date(),priority:z.enum(['low','medium','high','emergency']).default('medium'),assignedTo:z.string().refine(oid).optional()}).strict();
inspectionsRouter.get('/schedules',async(req,res,next)=>{
 try{const c=claimsFor(req);const filter:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};if(typeof req.query.status==='string'&&['active','paused'].includes(req.query.status))filter.status=req.query.status;
 const schedules=await InspectionSchedule.find(filter).populate('facilityId','code name').populate('assetId','assetTag name').populate('templateId','code title').populate('assignedTo','firstName lastName').sort({nextDueAt:1}).limit(200).lean();res.status(200).json({data:{schedules}});
 }catch(e){next(e);}
});
inspectionsRouter.post('/schedules',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=scheduleSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claimsFor(req);if(!inScope(c,p.data.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
 const [facility,asset,template]=await Promise.all([Facility.findOne({_id:p.data.facilityId,tenantId:c.tenantId,status:'active'}).select('_id'),Asset.findOne({_id:p.data.assetId,tenantId:c.tenantId,facilityId:p.data.facilityId,archivedAt:null}).select('_id'),InspectionTemplate.findOne({_id:p.data.templateId,tenantId:c.tenantId,active:true,$or:[{facilityId:{$exists:false}},{facilityId:null},{facilityId:p.data.facilityId}]}).select('_id')]);
 if(!facility||!asset||!template){res.status(404).json({error:{code:'SCHEDULE_RESOURCE_NOT_FOUND'}});return;}
 if(p.data.assignedTo){const {User}=await import('../models/user.model.js');if(!await User.exists({_id:p.data.assignedTo,tenantId:c.tenantId,status:'active'})){res.status(404).json({error:{code:'ASSIGNEE_NOT_FOUND'}});return;}}
 const userId=new Types.ObjectId(c.sub);const schedule=await InspectionSchedule.create({...p.data,tenantId:new Types.ObjectId(c.tenantId),facilityId:new Types.ObjectId(p.data.facilityId),assetId:new Types.ObjectId(p.data.assetId),templateId:new Types.ObjectId(p.data.templateId),assignedTo:p.data.assignedTo?new Types.ObjectId(p.data.assignedTo):undefined,createdBy:userId,updatedBy:userId});
 await AuditEvent.create({tenantId:schedule.tenantId,actorUserId:userId,facilityId:schedule.facilityId,entityType:'inspection',entityId:schedule._id,action:'created',changes:{schedule:true,intervalDays:schedule.intervalDays,nextDueAt:schedule.nextDueAt}});
 res.status(201).json({data:{schedule}});
 }catch(e){next(e);}
});
inspectionsRouter.patch('/schedules/:scheduleId/status',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const id=String(req.params.scheduleId??'');if(!oid(id)){res.status(400).json({error:{code:'INVALID_SCHEDULE_ID'}});return;}const p=z.object({status:z.enum(['active','paused'])}).strict().safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR'}});return;}const c=claimsFor(req);const schedule=await InspectionSchedule.findOne({_id:id,tenantId:c.tenantId});if(!schedule||!inScope(c,schedule.facilityId.toString())){res.status(404).json({error:{code:'SCHEDULE_NOT_FOUND'}});return;}schedule.status=p.data.status;schedule.updatedBy=new Types.ObjectId(c.sub);await schedule.save();res.status(200).json({data:{schedule}});
 }catch(e){next(e);}
});
inspectionsRouter.post('/schedules/:scheduleId/generate-work-order',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const id=String(req.params.scheduleId??'');if(!oid(id)){res.status(400).json({error:{code:'INVALID_SCHEDULE_ID'}});return;}const c=claimsFor(req);const schedule=await InspectionSchedule.findOne({_id:id,tenantId:c.tenantId,status:'active'});if(!schedule||!inScope(c,schedule.facilityId.toString())){res.status(404).json({error:{code:'ACTIVE_SCHEDULE_NOT_FOUND'}});return;}
 const dueAt=new Date(schedule.nextDueAt);if(dueAt.getTime()>Date.now()){res.status(409).json({error:{code:'INSPECTION_NOT_DUE_YET',nextDueAt:dueAt}});return;}const existing=await WorkOrder.findOne({tenantId:c.tenantId,sourceInspectionScheduleId:schedule._id,scheduledFor:dueAt});if(existing){res.status(200).json({data:{workOrder:existing,alreadyGenerated:true}});return;}
 const userId=new Types.ObjectId(c.sub);const workOrder=await WorkOrder.create({tenantId:schedule.tenantId,facilityId:schedule.facilityId,assetId:schedule.assetId,workOrderNumber:'ISCH-'+Date.now().toString(36).toUpperCase()+'-'+randomUUID().slice(0,6).toUpperCase(),title:'Scheduled inspection: '+schedule.title,description:'Complete checklist '+schedule.templateId.toString()+' and record the inspection result.',type:'inspection',status:'open',priority:schedule.priority,assignedTo:schedule.assignedTo,scheduledStart:dueAt,dueAt,scheduledFor:dueAt,sourceInspectionScheduleId:schedule._id,createdBy:userId,updatedBy:userId});
 schedule.lastGeneratedAt=new Date();schedule.nextDueAt=new Date(dueAt.getTime()+schedule.intervalDays*86400000);schedule.updatedBy=userId;await schedule.save();
 await AuditEvent.create({tenantId:schedule.tenantId,actorUserId:userId,facilityId:schedule.facilityId,entityType:'inspection',entityId:schedule._id,action:'updated',changes:{generatedWorkOrderId:workOrder._id,nextDueAt:schedule.nextDueAt}});
 res.status(201).json({data:{workOrder,schedule}});
 }catch(e){next(e);}
});
inspectionsRouter.patch('/:inspectionId/review',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const id=String(req.params.inspectionId??'');if(!oid(id)){res.status(400).json({error:{code:'INVALID_INSPECTION_ID'}});return;}const p=z.object({decision:z.enum(['approved','rejected']),notes:z.string().trim().max(2000).optional()}).strict().safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}if(p.data.decision==='rejected'&&!p.data.notes){res.status(400).json({error:{code:'REJECTION_NOTES_REQUIRED'}});return;}
 const c=claimsFor(req);const inspection=await Inspection.findOne({_id:id,tenantId:c.tenantId});if(!inspection||!inScope(c,inspection.facilityId.toString())){res.status(404).json({error:{code:'INSPECTION_NOT_FOUND'}});return;}if(inspection.reviewStatus!=='pending'){res.status(409).json({error:{code:'INSPECTION_ALREADY_REVIEWED'}});return;}if(inspection.performedBy.toString()===c.sub){res.status(403).json({error:{code:'SELF_REVIEW_NOT_ALLOWED'}});return;}
 inspection.reviewStatus=p.data.decision;inspection.reviewNotes=p.data.notes;inspection.reviewedBy=new Types.ObjectId(c.sub);inspection.reviewedAt=new Date();await inspection.save();
 await AuditEvent.create({tenantId:inspection.tenantId,actorUserId:new Types.ObjectId(c.sub),facilityId:inspection.facilityId,entityType:'inspection',entityId:inspection._id,action:'updated',changes:{reviewStatus:inspection.reviewStatus,reviewNotes:inspection.reviewNotes}});
 res.status(200).json({data:{inspection}});
 }catch(e){next(e);}
});
inspectionsRouter.get('/reports/summary',async(req,res,next)=>{
 try{const c=claimsFor(req);const match:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId),status:'completed'};if(!isAdmin(c))match.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};if(typeof req.query.from==='string'||typeof req.query.to==='string'){const performedAt:Record<string,Date>={};if(typeof req.query.from==='string'&&!Number.isNaN(Date.parse(req.query.from)))performedAt.$gte=new Date(req.query.from);if(typeof req.query.to==='string'&&!Number.isNaN(Date.parse(req.query.to)))performedAt.$lte=new Date(req.query.to);if(Object.keys(performedAt).length)match.performedAt=performedAt;}
 const rows=await Inspection.aggregate([{ $match:match },{$group:{_id:{category:'$templateSnapshot.category',result:'$overallResult'},count:{$sum:1},findings:{$sum:'$findingsCount'}}}]);
 const totals=rows.reduce((a,r)=>({inspections:a.inspections+r.count,findings:a.findings+r.findings,passed:a.passed+(r._id.result==='pass'?r.count:0),failed:a.failed+(r._id.result==='fail'?r.count:0)}),{inspections:0,findings:0,passed:0,failed:0});
 const byCategory=rows.reduce((a,r)=>{const key=String(r._id.category);a[key]??={inspections:0,passed:0,failed:0,findings:0};a[key].inspections+=r.count;a[key].findings+=r.findings;a[key][r._id.result==='pass'?'passed':'failed']+=r.count;return a;},{} as Record<string,{inspections:number;passed:number;failed:number;findings:number}>);
 res.status(200).json({data:{totals,byCategory,passRate:totals.inspections?Math.round(totals.passed/totals.inspections*100):0}});
 }catch(e){next(e);}
});
