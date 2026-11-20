import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {WorkOrder} from '../models/work-order.model.js';
import {StockMovement} from '../models/stock-movement.model.js';

export const analyticsRouter=Router();
analyticsRouter.use(authenticate);
const claimsFor=(r:Request):AccessClaims=>r.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
analyticsRouter.get('/summary',async(req,res,next)=>{
 try{
  const c=claimsFor(req);
  const endRaw=typeof req.query.to==='string'?new Date(req.query.to):new Date();
  const startRaw=typeof req.query.from==='string'?new Date(req.query.from):new Date(endRaw.getTime()-30*86400000);
  if(Number.isNaN(startRaw.getTime())||Number.isNaN(endRaw.getTime())||startRaw>=endRaw){res.status(400).json({error:{code:'INVALID_DATE_RANGE'}});return;}
  const start=new Date(startRaw),end=new Date(endRaw);if(typeof req.query.to==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.to))end.setUTCHours(23,59,59,999);
  const scope:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId)};
  if(!admin(c))scope.facilityId={$in:c.facilityIds.map(x=>new Types.ObjectId(x))};
  if(typeof req.query.facilityId==='string'){
   if(!Types.ObjectId.isValid(req.query.facilityId)||(!admin(c)&&!c.facilityIds.includes(req.query.facilityId))){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
   scope.facilityId=new Types.ObjectId(req.query.facilityId);
  }
  const [allOrders,issuedCosts,assetCount]=await Promise.all([
   WorkOrder.find({...scope,createdAt:{$lte:end}}).select('type status priority createdAt completedAt actualHours facilityId assetId dueAt').sort({createdAt:1}).limit(20000).lean(),
   StockMovement.aggregate([{$match:{...scope,movementType:'issue',occurredAt:{$gte:start,$lte:end}}},{$group:{_id:null,partsIssueCost:{$sum:{$multiply:[{$abs:'$quantity'},{$ifNull:['$unitCost',0]}]}},issuedLines:{$sum:1}}}]),
   WorkOrder.db.collection('assets').countDocuments({...scope,archivedAt:null})
  ]);
  const periodOrders=allOrders.filter(w=>new Date(w.createdAt)>=start&&new Date(w.createdAt)<=end);
  const completed=allOrders.filter(w=>w.status==='completed'&&w.completedAt&&new Date(w.completedAt)>=start&&new Date(w.completedAt)<=end);
  const open=allOrders.filter(w=>['open','assigned','in_progress','on_hold'].includes(w.status));
  const overdue=open.filter(w=>(w as any).dueAt&&new Date((w as any).dueAt)<end);
  const durations=completed.filter(w=>w.type==='corrective').map(w=>Math.max(0,(new Date(w.completedAt!).getTime()-new Date(w.createdAt).getTime())/3600000));
  const corrective=allOrders.filter(w=>w.type==='corrective'&&w.completedAt).sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());
  const lastByAsset=new Map<string,number>();const intervals:number[]=[];
  for(const w of corrective){const key=String((w as any).assetId);const t=new Date(w.createdAt).getTime();const prev=lastByAsset.get(key);if(prev!==undefined&&t>prev)intervals.push((t-prev)/3600000);lastByAsset.set(key,t);}
  const byStatus:Record<string,number>={open:0,assigned:0,in_progress:0,on_hold:0,completed:0,cancelled:0};
  for(const w of periodOrders)byStatus[w.status]=(byStatus[w.status]||0)+1;
  const byPriority:Record<string,number>={low:0,medium:0,high:0,emergency:0};
  for(const w of open)byPriority[w.priority]=(byPriority[w.priority]||0)+1;
  const monthly:Array<{month:string;created:number;completed:number}>=[];
  for(let cursor=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));cursor<=end;cursor.setUTCMonth(cursor.getUTCMonth()+1)){
   const next=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));
   monthly.push({month:cursor.toISOString().slice(0,7),created:periodOrders.filter(w=>{const d=new Date(w.createdAt);return d>=cursor&&d<next;}).length,completed:completed.filter(w=>{const d=new Date(w.completedAt!);return d>=cursor&&d<next;}).length});
  }
  const cost=issuedCosts[0]?.partsIssueCost||0;
  res.status(200).json({data:{period:{from:start,to:end},assetsTracked:assetCount,workOrders:{created:periodOrders.length,completed:completed.length,open:open.length,overdue:overdue.length,byStatus,byPriority},maintenance:{mttrHours:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*100)/100:null,mtbfHours:intervals.length?Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length*100)/100:null,correctiveWorkOrders:durations.length,repairElapsedHours:Math.round(durations.reduce((a,b)=>a+b,0)*100)/100},costs:{partsIssueCost:Math.round(cost*100)/100,currency:'movement unit-cost currency; mixed currencies are not converted',issuedLines:issuedCosts[0]?.issuedLines||0},trends:monthly,methodology:{mttr:'Mean elapsed hours from corrective work-order creation to completion; this is not technician labor time.',mtbf:'Mean interval between completed corrective work-order creation timestamps for the same asset; requires consistent failure logging.',downtime:'Repair elapsed time is a work-order proxy, not verified asset downtime. Availability is not calculated without explicit downtime events and scheduled operating hours.',cost:'Parts issue cost only where stock movement unitCost is present; labor, overhead, tax and multi-currency conversion are excluded.'}}});
 }catch(e){next(e);}
});
