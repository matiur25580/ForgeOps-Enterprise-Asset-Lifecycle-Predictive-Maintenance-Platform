import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import {z} from 'zod';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {authorize} from '../middleware/authorize.js';
import {Asset} from '../models/asset.model.js';
import {WorkOrder} from '../models/work-order.model.js';
import {DowntimeEvent} from '../models/downtime-event.model.js';
import {AuditEvent} from '../models/audit-event.model.js';
export const downtimeRouter=Router();downtimeRouter.use(authenticate);
const claims=(r:Request):AccessClaims=>r.auth!;
const isAdmin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const canFacility=(c:AccessClaims,id:string)=>isAdmin(c)||c.facilityIds.includes(id);
const idSchema=z.string().refine(Types.ObjectId.isValid);
const createSchema=z.object({assetId:idSchema,workOrderId:idSchema.optional(),cause:z.enum(['breakdown','planned_maintenance','inspection','utility_outage','other']),title:z.string().trim().min(3).max(160),description:z.string().trim().max(2000).optional(),startedAt:z.coerce.date()}).strict();
const resolveSchema=z.object({endedAt:z.coerce.date().optional()}).strict();
const verifySchema=z.object({decision:z.enum(['verified','rejected']),notes:z.string().trim().max(1000).optional()}).strict().refine(x=>x.decision!=='rejected'||Boolean(x.notes?.trim()));
downtimeRouter.get('/events',async(req,res,next)=>{try{
 const c=claims(req);const filter:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
 if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
 if(typeof req.query.facilityId==='string'){if(!Types.ObjectId.isValid(req.query.facilityId)||!canFacility(c,req.query.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}filter.facilityId=new Types.ObjectId(req.query.facilityId);}
 if(typeof req.query.assetId==='string'){if(!Types.ObjectId.isValid(req.query.assetId)){res.status(400).json({error:{code:'INVALID_ASSET_ID'}});return;}filter.assetId=new Types.ObjectId(req.query.assetId);}
 if(typeof req.query.status==='string'&&['open','resolved'].includes(req.query.status))filter.status=req.query.status;
 if(typeof req.query.verificationStatus==='string'&&['pending','verified','rejected'].includes(req.query.verificationStatus))filter.verificationStatus=req.query.verificationStatus;
 const from=typeof req.query.from==='string'?new Date(req.query.from):undefined;const to=typeof req.query.to==='string'?new Date(req.query.to):undefined;
 if((from&&Number.isNaN(from.getTime()))||(to&&Number.isNaN(to.getTime()))){res.status(400).json({error:{code:'INVALID_DATE_RANGE'}});return;}
 if(from||to)filter.startedAt={...(from?{$gte:from}:{}),...(to?{$lte:to}:{})};
 const events=await DowntimeEvent.find(filter).populate('assetId','assetTag name').populate('facilityId','code name').populate('workOrderId','workOrderNumber title').populate('reportedBy','firstName lastName').sort({startedAt:-1}).limit(500).lean();
 res.status(200).json({data:{events}});
 }catch(e){next(e);}});
downtimeRouter.post('/events',authorize('owner','admin','manager','technician'),async(req,res,next)=>{try{
 const parsed=createSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claims(req);if(parsed.data.startedAt.getTime()>Date.now()+5*60*1000){res.status(400).json({error:{code:'DOWNTIME_START_IN_FUTURE'}});return;}
 const asset=await Asset.findOne({_id:parsed.data.assetId,tenantId:c.tenantId,archivedAt:null}).select('_id facilityId');
 if(!asset){res.status(404).json({error:{code:'ASSET_NOT_FOUND'}});return;}
 if(!canFacility(c,asset.facilityId.toString())){res.status(404).json({error:{code:'ASSET_NOT_FOUND'}});return;}
 if(parsed.data.workOrderId){const wo=await WorkOrder.findOne({_id:parsed.data.workOrderId,tenantId:c.tenantId,assetId:asset._id,facilityId:asset.facilityId}).select('_id');if(!wo){res.status(400).json({error:{code:'WORK_ORDER_ASSET_MISMATCH'}});return;}}
 const open=await DowntimeEvent.findOne({tenantId:c.tenantId,assetId:asset._id,status:'open'}).select('_id');
 if(open){res.status(409).json({error:{code:'ASSET_ALREADY_IN_DOWNTIME',eventId:open._id}});return;}
 let event;
 try{event=await DowntimeEvent.create({...parsed.data,tenantId:new Types.ObjectId(c.tenantId),facilityId:asset.facilityId,assetId:asset._id,workOrderId:parsed.data.workOrderId?new Types.ObjectId(parsed.data.workOrderId):undefined,reportedBy:new Types.ObjectId(c.sub)});}
 catch(error){if(typeof error==='object'&&error!==null&&'code' in error&&error.code===11000){res.status(409).json({error:{code:'ASSET_ALREADY_IN_DOWNTIME'}});return;}throw error;}
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:asset.facilityId,entityType:'downtime_event',entityId:event._id,action:'created',changes:{cause:event.cause,startedAt:event.startedAt}});
 res.status(201).json({data:{event}});
 }catch(e){next(e);}});
downtimeRouter.patch('/events/:eventId/resolve',async(req,res,next)=>{try{
 const eventId=req.params.eventId;if(typeof eventId!=='string'||!Types.ObjectId.isValid(eventId)){res.status(400).json({error:{code:'INVALID_EVENT_ID'}});return;}
 const parsed=resolveSchema.safeParse(req.body??{});if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claims(req);const event=await DowntimeEvent.findOne({_id:eventId,tenantId:c.tenantId,...(isAdmin(c)?{}:{facilityId:{$in:c.facilityIds.map(x=>new Types.ObjectId(x))}})});
 if(!event){res.status(404).json({error:{code:'DOWNTIME_EVENT_NOT_FOUND'}});return;}
 if(event.status!=='open'){res.status(409).json({error:{code:'DOWNTIME_EVENT_ALREADY_RESOLVED'}});return;}
 if(c.role==='technician'&&event.reportedBy.toString()!==c.sub){res.status(403).json({error:{code:'FORBIDDEN'}});return;}
 const endedAt=parsed.data.endedAt??new Date();if(endedAt.getTime()<=event.startedAt.getTime()||endedAt.getTime()>Date.now()+5*60*1000){res.status(400).json({error:{code:'INVALID_DOWNTIME_END'}});return;}
 event.endedAt=endedAt;event.status='resolved';event.resolvedBy=new Types.ObjectId(c.sub);event.verificationStatus='pending';await event.save();
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:event.facilityId,entityType:'downtime_event',entityId:event._id,action:'updated',changes:{status:'resolved',endedAt}});
 res.status(200).json({data:{event}});
 }catch(e){next(e);}});
downtimeRouter.patch('/events/:eventId/verify',authorize('owner','admin','manager'),async(req,res,next)=>{try{
 const eventId=req.params.eventId;if(typeof eventId!=='string'||!Types.ObjectId.isValid(eventId)){res.status(400).json({error:{code:'INVALID_EVENT_ID'}});return;}
 const parsed=verifySchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const c=claims(req);const event=await DowntimeEvent.findOne({_id:eventId,tenantId:c.tenantId,...(isAdmin(c)?{}:{facilityId:{$in:c.facilityIds.map(x=>new Types.ObjectId(x))}})});
 if(!event){res.status(404).json({error:{code:'DOWNTIME_EVENT_NOT_FOUND'}});return;}
 if(event.status!=='resolved'){res.status(409).json({error:{code:'DOWNTIME_EVENT_NOT_RESOLVED'}});return;}
 if(event.reportedBy.toString()===c.sub){res.status(403).json({error:{code:'SELF_VERIFICATION_FORBIDDEN'}});return;}
 event.verificationStatus=parsed.data.decision;if(parsed.data.notes!==undefined)event.verificationNotes=parsed.data.notes;event.verifiedBy=new Types.ObjectId(c.sub);event.verifiedAt=new Date();await event.save();
 await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:event.facilityId,entityType:'downtime_event',entityId:event._id,action:'updated',changes:{verificationStatus:event.verificationStatus}});
 res.status(200).json({data:{event}});
 }catch(e){next(e);}});
