import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { AccessClaims } from '../auth/token.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { Asset } from '../models/asset.model.js';
import { AssetAlert } from '../models/asset-alert.model.js';
import { TelemetryAlertRule } from '../models/telemetry-alert-rule.model.js';
import { WorkOrder } from '../models/work-order.model.js';
import { AuditEvent } from '../models/audit-event.model.js';

export const alertsRouter = Router();
alertsRouter.use(authenticate);
const claims = (r: Request): AccessClaims => r.auth!;
const isAdmin = (c: AccessClaims) => c.role === 'owner' || c.role === 'admin';
const inScope = (c: AccessClaims, facilityId: string) => isAdmin(c) || c.facilityIds.includes(facilityId);
const metricSchema = z.enum(['temperature_c','vibration_mm_s','pressure_bar','current_amp']);
const ruleSchema = z.object({
  metric: metricSchema,
  warningThreshold: z.number().finite(),
  criticalThreshold: z.number().finite(),
  direction: z.enum(['high','low']),
  enabled: z.boolean().default(true)
}).strict().refine(v => v.direction === 'high' ? v.criticalThreshold > v.warningThreshold : v.criticalThreshold < v.warningThreshold, {
  message: 'Critical threshold must be more severe than warning threshold.'
});

alertsRouter.get('/rules', async (req,res,next) => {
  try {
    const c=claims(req);
    const rules=await TelemetryAlertRule.find({tenantId:c.tenantId}).sort({metric:1}).lean();
    res.status(200).json({data:{rules}});
  } catch(e) { next(e); }
});
alertsRouter.put('/rules/:metric', authorize('owner','admin','manager'), async(req,res,next) => {
  try {
    const parsed=ruleSchema.safeParse({...req.body,metric:req.params.metric});
    if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
    const c=claims(req); const nowUser=new Types.ObjectId(c.sub);
    const rule=await TelemetryAlertRule.findOneAndUpdate(
      {tenantId:c.tenantId,metric:parsed.data.metric},
      {$set:{...parsed.data,updatedBy:nowUser},$setOnInsert:{tenantId:new Types.ObjectId(c.tenantId),createdBy:nowUser}},
      {upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true}
    );
    res.status(200).json({data:{rule}});
  } catch(e) { next(e); }
});
alertsRouter.get('/', async(req,res,next) => {
  try {
    const c=claims(req);
    const filter:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
    if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
    if(typeof req.query.status==='string' && ['open','acknowledged','resolved'].includes(req.query.status))filter.status=req.query.status;
    if(typeof req.query.severity==='string' && ['warning','critical'].includes(req.query.severity))filter.severity=req.query.severity;
    if(typeof req.query.facilityId==='string'){
      if(!Types.ObjectId.isValid(req.query.facilityId)||!inScope(c,req.query.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
      filter.facilityId=new Types.ObjectId(req.query.facilityId);
    }
    const alerts=await AssetAlert.find(filter).populate('assetId','assetTag name criticality').populate('facilityId','code name').populate('workOrderId','workOrderNumber status').sort({lastTriggeredAt:-1}).limit(200).lean();
    const summary={open:alerts.filter(a=>a.status==='open').length,acknowledged:alerts.filter(a=>a.status==='acknowledged').length,resolved:alerts.filter(a=>a.status==='resolved').length,critical:alerts.filter(a=>a.severity==='critical'&&a.status!=='resolved').length};
    res.status(200).json({data:{alerts,summary}});
  } catch(e) { next(e); }
});
alertsRouter.patch('/:alertId/acknowledge', authorize('owner','admin','manager','technician'), async(req,res,next) => {
  try {
    const c=claims(req);const id=req.params.alertId;
    if(!Types.ObjectId.isValid(id)){res.status(400).json({error:{code:'INVALID_ALERT_ID'}});return;}
    const alert=await AssetAlert.findOne({_id:id,tenantId:c.tenantId});
    if(!alert||!inScope(c,alert.facilityId.toString())){res.status(404).json({error:{code:'ALERT_NOT_FOUND'}});return;}
    if(alert.status==='resolved'){res.status(409).json({error:{code:'ALERT_ALREADY_RESOLVED'}});return;}
    if(alert.status==='open'){alert.status='acknowledged';alert.acknowledgedAt=new Date();alert.acknowledgedBy=new Types.ObjectId(c.sub);await alert.save();await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:alert.facilityId,entityType:'asset_alert',entityId:alert._id,action:'acknowledged',changes:{status:'acknowledged'}});}
    res.status(200).json({data:{alert}});
  } catch(e) { next(e); }
});
alertsRouter.patch('/:alertId/resolve', authorize('owner','admin','manager'), async(req,res,next) => {
  try {
    const c=claims(req);const id=req.params.alertId;
    if(!Types.ObjectId.isValid(id)){res.status(400).json({error:{code:'INVALID_ALERT_ID'}});return;}
    const alert=await AssetAlert.findOne({_id:id,tenantId:c.tenantId});
    if(!alert||!inScope(c,alert.facilityId.toString())){res.status(404).json({error:{code:'ALERT_NOT_FOUND'}});return;}
    if(alert.status!=='resolved'){alert.status='resolved';alert.resolvedAt=new Date();alert.resolvedBy=new Types.ObjectId(c.sub);await alert.save();await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:alert.facilityId,entityType:'asset_alert',entityId:alert._id,action:'resolved',changes:{status:'resolved'}});}
    res.status(200).json({data:{alert}});
  } catch(e) { next(e); }
});
alertsRouter.post('/:alertId/work-order', authorize('owner','admin','manager'), async(req,res,next) => {
  try {
    const c=claims(req);const id=req.params.alertId;
    if(!Types.ObjectId.isValid(id)){res.status(400).json({error:{code:'INVALID_ALERT_ID'}});return;}
    const alert=await AssetAlert.findOne({_id:id,tenantId:c.tenantId});
    if(!alert||!inScope(c,alert.facilityId.toString())){res.status(404).json({error:{code:'ALERT_NOT_FOUND'}});return;}
    if(alert.workOrderId){const existing=await WorkOrder.findOne({_id:alert.workOrderId,tenantId:c.tenantId});if(existing){res.status(200).json({data:{workOrder:existing,alreadyLinked:true}});return;}}
    const asset=await Asset.findOne({_id:alert.assetId,tenantId:c.tenantId,facilityId:alert.facilityId,archivedAt:null}).select('_id');
    if(!asset){res.status(409).json({error:{code:'ALERT_ASSET_UNAVAILABLE'}});return;}
    const workOrder=await WorkOrder.create({
      tenantId:alert.tenantId,facilityId:alert.facilityId,assetId:alert.assetId,
      workOrderNumber:'AL-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,8).toUpperCase(),
      title:'Investigate '+alert.metric+' alert',description:alert.message,type:'corrective',
      status:'open',priority:alert.severity==='critical'?'emergency':'high',
      sourceAlertId:alert._id,createdBy:new Types.ObjectId(c.sub),updatedBy:new Types.ObjectId(c.sub)
    });
    alert.workOrderId=workOrder._id;await alert.save();
    await AuditEvent.create({tenantId:new Types.ObjectId(c.tenantId),actorUserId:new Types.ObjectId(c.sub),facilityId:alert.facilityId,entityType:'work_order',entityId:workOrder._id,action:'created',changes:{sourceAlertId:alert._id,metric:alert.metric}});
    res.status(201).json({data:{workOrder,alreadyLinked:false}});
  } catch(e) { next(e); }
});
