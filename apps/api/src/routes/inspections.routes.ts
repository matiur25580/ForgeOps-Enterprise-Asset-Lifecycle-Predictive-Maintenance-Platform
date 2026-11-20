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
 status:'completed',responses:p.data.responses,overallResult:failures.length?'fail':'pass',findingsCount:failures.length,
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
 try{const c=claimsFor(req);const id=req.params.inspectionId;if(!oid(id)){res.status(400).json({error:{code:'INVALID_INSPECTION_ID'}});return;}
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
