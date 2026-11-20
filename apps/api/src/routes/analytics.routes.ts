import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {WorkOrder} from '../models/work-order.model.js';
import {StockMovement} from '../models/stock-movement.model.js';
import {Asset} from '../models/asset.model.js';
import {DowntimeEvent} from '../models/downtime-event.model.js';

export const analyticsRouter=Router();
analyticsRouter.use(authenticate);
const claimsFor=(r:Request):AccessClaims=>r.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
analyticsRouter.get('/summary',async(req,res,next)=>{
 try{
  const c=claimsFor(req);
  const endRaw=typeof req.query.to==='string'?new Date(req.query.to):new Date();
  const startRaw=typeof req.query.from==='string'?new Date(req.query.from):new Date(endRaw.getTime()-30*86400000);
  const start=new Date(startRaw),end=new Date(endRaw);
  if(typeof req.query.to==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.to))end.setUTCHours(23,59,59,999);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>=end){res.status(400).json({error:{code:'INVALID_DATE_RANGE'}});return;}
  const scope:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
  if(!admin(c))scope.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
  if(typeof req.query.facilityId==='string'){
   if(!Types.ObjectId.isValid(req.query.facilityId)||(!admin(c)&&!c.facilityIds.includes(req.query.facilityId))){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
   scope.facilityId=new Types.ObjectId(req.query.facilityId);
  }
  const [allOrders,issuedCosts,assetCount,operatingAssets,downtimeEvents]=await Promise.all([
   WorkOrder.find({...scope,createdAt:{$lte:end}}).select('type status priority createdAt completedAt actualHours facilityId assetId dueAt laborCost externalServiceCost costCurrency').sort({createdAt:-1}).limit(20000).lean(),
   StockMovement.aggregate([{$match:{...scope,movementType:'issue',occurredAt:{$gte:start,$lte:end}}},{$group:{_id:'$currency',partsIssueCost:{$sum:{$multiply:[{$abs:'$quantity'},{$ifNull:['$unitCost',0]}]}},issuedLines:{$sum:1}}}]),
   Asset.countDocuments({...scope,archivedAt:null}),
   Asset.find({...scope,archivedAt:null,scheduledOperatingHoursPerWeek:{$gt:0}}).select('_id scheduledOperatingHoursPerWeek').lean(),
   DowntimeEvent.find({...scope,verificationStatus:'verified',status:'resolved',startedAt:{$lt:end},endedAt:{$gt:start}}).select('assetId startedAt endedAt cause').lean()
  ]);
  const periodOrders=allOrders.filter(w=>{const t=new Date(w.createdAt??0).getTime();return t>=start.getTime()&&t<=end.getTime();});
  const completed=allOrders.filter(w=>w.status==='completed'&&w.completedAt&&new Date(w.completedAt).getTime()>=start.getTime()&&new Date(w.completedAt).getTime()<=end.getTime());
  const open=allOrders.filter(w=>['open','assigned','in_progress','on_hold'].includes(w.status));
  const overdue=open.filter(w=>w.dueAt&&new Date(w.dueAt).getTime()<end.getTime());
  const durations=completed.filter(w=>w.type==='corrective'&&w.completedAt).map(w=>Math.max(0,(new Date(w.completedAt!).getTime()-new Date(w.createdAt??0).getTime())/3600000));
  const corrective=allOrders.filter(w=>w.type==='corrective'&&w.completedAt).sort((a,b)=>new Date(a.createdAt??0).getTime()-new Date(b.createdAt??0).getTime());
  const lastByAsset=new Map<string,number>();const intervals:number[]=[];
  for(const w of corrective){const key=w.assetId.toString();const t=new Date(w.createdAt??0).getTime();const prev=lastByAsset.get(key);if(prev!==undefined&&t>prev)intervals.push((t-prev)/3600000);lastByAsset.set(key,t);}
  const byStatus:Record<string,number>={open:0,assigned:0,in_progress:0,on_hold:0,completed:0,cancelled:0};
  for(const w of periodOrders)byStatus[w.status]=(byStatus[w.status]||0)+1;
  const byPriority:Record<string,number>={low:0,medium:0,high:0,emergency:0};
  for(const w of open)byPriority[w.priority]=(byPriority[w.priority]||0)+1;
  const monthly:Array<{month:string;created:number;completed:number}>=[];
  for(let cursor=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));cursor<=end;cursor.setUTCMonth(cursor.getUTCMonth()+1)){
   const next=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));
   monthly.push({month:cursor.toISOString().slice(0,7),created:periodOrders.filter(w=>{const d=new Date(w.createdAt??0);return d>=cursor&&d<next;}).length,completed:completed.filter(w=>{const d=new Date(w.completedAt!);return d>=cursor&&d<next;}).length});
  }
  const periodMs=end.getTime()-start.getTime();
  const downtimeByAsset=new Map<string,Array<{start:number;end:number;cause:string}>>();
  for(const event of downtimeEvents){const key=event.assetId.toString();const rows=downtimeByAsset.get(key)||[];rows.push({start:Math.max(start.getTime(),new Date(event.startedAt).getTime()),end:Math.min(end.getTime(),new Date(event.endedAt!).getTime()),cause:event.cause});downtimeByAsset.set(key,rows);}
  let scheduledMinutes=0,verifiedDowntimeMinutes=0,plannedDowntimeMinutes=0,unplannedDowntimeMinutes=0;
  for(const asset of operatingAssets){
   const weeklyHours=asset.scheduledOperatingHoursPerWeek||0;
   scheduledMinutes+=weeklyHours*60*periodMs/(7*86400000);
   const rows=(downtimeByAsset.get(asset._id.toString())||[]).filter(x=>x.end>x.start).sort((x,y)=>x.start-y.start);
   let mergedEnd=-Infinity;
   for(const row of rows){const overlapStart=Math.max(row.start,mergedEnd);const minutes=Math.max(0,row.end-overlapStart)/60000;if(minutes>0){verifiedDowntimeMinutes+=minutes;if(row.cause==='planned_maintenance'||row.cause==='inspection')plannedDowntimeMinutes+=minutes;else unplannedDowntimeMinutes+=minutes;}mergedEnd=Math.max(mergedEnd,row.end);}
  }
  const availabilityPercent=scheduledMinutes>0?Math.max(0,Math.min(100,(1-verifiedDowntimeMinutes/scheduledMinutes)*100)):null;
  const laborByCurrency=new Map<string,number>(),externalByCurrency=new Map<string,number>();
  for(const wo of completed){const currency=wo.costCurrency||'USD';laborByCurrency.set(currency,(laborByCurrency.get(currency)||0)+(wo.laborCost||0));externalByCurrency.set(currency,(externalByCurrency.get(currency)||0)+(wo.externalServiceCost||0));}
  const currencies=new Set<string>([...laborByCurrency.keys(),...externalByCurrency.keys(),...issuedCosts.map((x:{_id:string})=>x._id).filter(Boolean)]);
  const maintenanceCosts=[...currencies].sort().map(currency=>{const parts=issuedCosts.find((x:{_id:string;partsIssueCost:number})=>x._id===currency)?.partsIssueCost||0;const labor=laborByCurrency.get(currency)||0;const external=externalByCurrency.get(currency)||0;return{currency,laborCost:Math.round(labor*100)/100,externalServiceCost:Math.round(external*100)/100,partsIssueCost:Math.round(parts*100)/100,total:Math.round((labor+external+parts)*100)/100};});
  res.status(200).json({data:{
   period:{from:start,to:end},assetsTracked:assetCount,
   workOrders:{created:periodOrders.length,completed:completed.length,open:open.length,overdue:overdue.length,byStatus,byPriority},
   maintenance:{mttrHours:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*100)/100:null,mtbfHours:intervals.length?Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length*100)/100:null,correctiveWorkOrders:durations.length,repairElapsedHours:Math.round(durations.reduce((a,b)=>a+b,0)*100)/100},
   availability:{availabilityPercent:availabilityPercent===null?null:Math.round(availabilityPercent*100)/100,measuredAssets:operatingAssets.length,unmeasuredAssets:Math.max(0,assetCount-operatingAssets.length),scheduledOperatingMinutes:Math.round(scheduledMinutes),verifiedDowntimeMinutes:Math.round(verifiedDowntimeMinutes),plannedDowntimeMinutes:Math.round(plannedDowntimeMinutes),unplannedDowntimeMinutes:Math.round(unplannedDowntimeMinutes)},
   costs:{partsIssueCost:maintenanceCosts.length<=1?(maintenanceCosts[0]?.partsIssueCost||0):null,currency:maintenanceCosts.length===1?maintenanceCosts[0].currency:null,byCurrency:maintenanceCosts,issuedLines:issuedCosts.reduce((sum:number,x:{issuedLines:number})=>sum+x.issuedLines,0)},
   trends:monthly,
   methodology:{
    mttr:'Mean elapsed hours from corrective work-order creation to completion; not technician labor time.',
    mtbf:'Mean interval between completed corrective work-order creation timestamps for the same asset; requires consistent failure logging.',
    downtime:'Availability uses resolved and independently verified downtime events; open or unverified events are not verified and are excluded. Assets need scheduledOperatingHoursPerWeek configured. Weekly hours are spread evenly across the reporting interval; use a detailed shift calendar for precise shift-based availability. Unconfigured assets are excluded.',
    cost:'Labor and external service amounts are entered on work orders; parts issue cost uses stock ledger unit cost and spare-part currency. Totals are grouped by currency; no currency conversion, tax, or overhead is applied.'
   }
  }});
 }catch(e){next(e);}
});
