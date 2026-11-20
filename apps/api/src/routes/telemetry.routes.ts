import {Router, type Request} from 'express';
import {Types} from 'mongoose';
import {z} from 'zod';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {authorize} from '../middleware/authorize.js';
import {Asset} from '../models/asset.model.js';
import {TelemetryReading, type TelemetryMetric} from '../models/telemetry-reading.model.js';

export const telemetryRouter=Router();
telemetryRouter.use(authenticate);
const idOk=(v:string)=>Types.ObjectId.isValid(v);
const claims=(r:Request):AccessClaims=>r.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const allowed=(c:AccessClaims,facility:string)=>admin(c)||c.facilityIds.includes(facility);
const simulationSchema=z.object({assetId:z.string().refine(idOk),samples:z.number().int().min(6).max(48).default(24)}).strict();
const thresholds:Record<TelemetryMetric,{unit:string;warning:number;critical:number;direction:'high'|'low'}>={
 temperature_c:{unit:'°C',warning:75,critical:90,direction:'high'},
 vibration_mm_s:{unit:'mm/s',warning:4.5,critical:7.1,direction:'high'},
 pressure_bar:{unit:'bar',warning:2,critical:1,direction:'low'},
 current_amp:{unit:'A',warning:80,critical:100,direction:'high'}
};
function risk(metric:TelemetryMetric,value:number){const t=thresholds[metric];if(t.direction==='high')return value>=t.critical?'critical':value>=t.warning?'warning':'normal';return value<=t.critical?'critical':value<=t.warning?'warning':'normal';}
function healthScore(latest:Partial<Record<TelemetryMetric,number>>,criticality:string){
 let score=100;const factors:{metric:string;value:number;severity:string;impact:number}[]=[];
 for(const [key,value] of Object.entries(latest) as [TelemetryMetric,number][]){const severity=risk(key,value);const impact=severity==='critical'?35:severity==='warning'?15:0;score-=impact;factors.push({metric:key,value,severity,impact});}
 if(criticality==='critical')score-=5;else if(criticality==='high')score-=2;
 score=Math.max(0,Math.min(100,score));
 return {score,band:score>=85?'healthy':score>=65?'watch':score>=40?'at_risk':'critical',factors,method:'Transparent threshold heuristic; not a trained predictive model.'};
}
telemetryRouter.get('/health',async(req,res,next)=>{
 try{const c=claims(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId),archivedAt:null};if(!admin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};if(typeof req.query.facilityId==='string'){if(!idOk(req.query.facilityId)||!allowed(c,req.query.facilityId)){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}filter.facilityId=new Types.ObjectId(req.query.facilityId);}
 const assets=await Asset.find(filter).select('_id assetTag name criticality facilityId lifecycleStatus').populate('facilityId','code name').limit(500).lean();
 const health=await Promise.all(assets.map(async a=>{const rows=await TelemetryReading.aggregate([{$match:{tenantId:new Types.ObjectId(c.tenantId),assetId:a._id}},{$sort:{recordedAt:-1}},{$group:{_id:'$metric',value:{$first:'$value'},recordedAt:{$first:'$recordedAt'},unit:{$first:'$unit'}}}]);const latest:any={};for(const row of rows)latest[row._id as TelemetryMetric]=row.value;const assessment=healthScore(latest,a.criticality);return{asset:{_id:a._id,assetTag:a.assetTag,name:a.name,criticality:a.criticality,lifecycleStatus:a.lifecycleStatus,facility:a.facilityId},...assessment,telemetry:rows};}));
 res.status(200).json({data:{assets:health,summary:{total:health.length,healthy:health.filter(x=>x.band==='healthy').length,watch:health.filter(x=>x.band==='watch').length,atRisk:health.filter(x=>x.band==='at_risk').length,critical:health.filter(x=>x.band==='critical').length}}});
 }catch(e){next(e);}
});
telemetryRouter.get('/readings',async(req,res,next)=>{
 try{const c=claims(req);const filter:any={tenantId:new Types.ObjectId(c.tenantId)};if(typeof req.query.assetId==='string'){if(!idOk(req.query.assetId)){res.status(400).json({error:{code:'INVALID_ASSET_ID'}});return;}const asset=await Asset.findOne({_id:req.query.assetId,tenantId:c.tenantId,archivedAt:null}).select('facilityId');if(!asset||!allowed(c,asset.facilityId.toString())){res.status(404).json({error:{code:'ASSET_NOT_FOUND'}});return;}filter.assetId=asset._id;}else if(!admin(c))filter.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
 const readings=await TelemetryReading.find(filter).sort({recordedAt:-1}).limit(500).populate('assetId','assetTag name').lean();res.status(200).json({data:{readings}});
 }catch(e){next(e);}
});
telemetryRouter.post('/simulate',authorize('owner','admin','manager'),async(req,res,next)=>{
 try{const p=simulationSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:p.error.flatten()}});return;}const c=claims(req);const asset=await Asset.findOne({_id:p.data.assetId,tenantId:c.tenantId,archivedAt:null});if(!asset||!allowed(c,asset.facilityId.toString())){res.status(404).json({error:{code:'ASSET_NOT_FOUND'}});return;}
 const base:Record<TelemetryMetric,number>={temperature_c:asset.criticality==='critical'?82:65,vibration_mm_s:asset.criticality==='high'?5.2:2.1,pressure_bar:3.4,current_amp:asset.criticality==='critical'?86:48};
 const metrics=Object.keys(thresholds) as TelemetryMetric[];const now=Date.now();const readings=[] as any[];
 for(let i=0;i<p.data.samples;i++){for(const metric of metrics){const drift=asset.lifecycleStatus==='maintenance'?0.55:1;const noise=(Math.random()-.5)*(metric==='pressure_bar'?.7:metric==='current_amp'?12:metric==='temperature_c'?10:1.4);let value=base[metric]*drift+noise;if(metric==='pressure_bar')value=Math.max(.1,value);else value=Math.max(0,value);readings.push({tenantId:new Types.ObjectId(c.tenantId),facilityId:asset.facilityId,assetId:asset._id,metric,value:Number(value.toFixed(2)),unit:thresholds[metric].unit,quality:'good',source:'simulator',recordedAt:new Date(now-(p.data.samples-i)*60_000)});}}
 await TelemetryReading.insertMany(readings);res.status(201).json({data:{assetId:asset._id,samples:p.data.samples,readingsCreated:readings.length,metrics,source:'simulator'}});
 }catch(e){next(e);}
});
