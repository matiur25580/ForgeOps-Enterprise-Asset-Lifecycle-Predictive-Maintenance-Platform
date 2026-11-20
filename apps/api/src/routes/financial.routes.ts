import {Router,type Request} from 'express';
import {Types,type FilterQuery} from 'mongoose';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {Asset,type AssetRecord} from '../models/asset.model.js';
import {WorkOrder} from '../models/work-order.model.js';
import {StockMovement} from '../models/stock-movement.model.js';

export const financialRouter=Router();
financialRouter.use(authenticate);
const claims=(r:Request):AccessClaims=>r.auth!;
const isAdmin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
function monthsBetween(start:Date,end:Date):number{return Math.max(0,(end.getTime()-start.getTime())/(365.2425/12*86400000));}
financialRouter.get('/asset-register',async(req,res,next)=>{
 try{
  const c=claims(req);const asOf=typeof req.query.asOf==='string'?new Date(req.query.asOf):new Date();
  if(Number.isNaN(asOf.getTime())){res.status(400).json({error:{code:'INVALID_AS_OF_DATE'}});return;}
  const filter:FilterQuery<AssetRecord>={tenantId:new Types.ObjectId(c.tenantId),archivedAt:null};
  if(!isAdmin(c))filter.facilityId={$in:c.facilityIds.map(id=>new Types.ObjectId(id))};
  if(typeof req.query.facilityId==='string'){
   if(!Types.ObjectId.isValid(req.query.facilityId)||(!isAdmin(c)&&!c.facilityIds.includes(req.query.facilityId))){res.status(404).json({error:{code:'FACILITY_NOT_FOUND'}});return;}
   filter.facilityId=new Types.ObjectId(req.query.facilityId);
  }
  const assets=await Asset.find(filter).sort({assetTag:1}).limit(5000).lean();
  const ids=assets.map(a=>a._id);
  const [workCosts,partsCosts]=await Promise.all([
   WorkOrder.aggregate([{$match:{tenantId:new Types.ObjectId(c.tenantId),assetId:{$in:ids},status:'completed'}},{$group:{_id:{assetId:'$assetId',currency:{$ifNull:['$costCurrency','USD']}},labor:{$sum:{$ifNull:['$laborCost',0]}},external:{$sum:{$ifNull:['$externalServiceCost',0]}}}}]),
   StockMovement.aggregate([{$match:{tenantId:new Types.ObjectId(c.tenantId),movementType:'issue',workOrderId:{$ne:null}}},{$lookup:{from:'workorders',localField:'workOrderId',foreignField:'_id',as:'workOrder'}},{$unwind:'$workOrder'},{$match:{'workOrder.assetId':{$in:ids},'workOrder.status':'completed'}},{$group:{_id:{assetId:'$workOrder.assetId',currency:'$currency'},parts:{$sum:{$multiply:[{$abs:'$quantity'},{$ifNull:['$unitCost',0]}]}}}}])
  ]);
  const costs=new Map<string,Array<{currency:string,labor:number,external:number,parts:number}>>();
  const add=(id:string,currency:string,field:'labor'|'external'|'parts',amount:number)=>{const rows=costs.get(id)||[];let row=rows.find(x=>x.currency===currency);if(!row){row={currency,labor:0,external:0,parts:0};rows.push(row);}row[field]+=amount;costs.set(id,rows);};
  for(const row of workCosts)add(row._id.assetId.toString(),row._id.currency,'labor',row.labor);
  for(const row of workCosts)add(row._id.assetId.toString(),row._id.currency,'external',row.external);
  for(const row of partsCosts)add(row._id.assetId.toString(),row._id.currency,'parts',row.parts);
  const warrantyCounts={active:0,expiringSoon:0,expired:0,notRecorded:0};
  const totals=new Map<string,{acquisitionCost:number,netBookValue:number,maintenanceCost:number,tco:number}>();
  const rows=assets.map(a=>{
   const currency=a.currency||'USD';const purchase=a.purchaseCost||0;const salvage=Math.min(purchase,a.salvageValue||0);const life=a.usefulLifeMonths||0;const start=a.depreciationStartDate||a.commissionedAt;const elapsed=start?monthsBetween(new Date(start),asOf):0;const depreciable=life>0?Math.max(0,purchase-salvage):0;const accumulated=life>0?Math.min(depreciable,depreciable*elapsed/life):0;const nbv=purchase-accumulated;
   const warrantyEnd=a.warrantyExpiresAt?new Date(a.warrantyExpiresAt):null;let warrantyStatus:'active'|'expiring_soon'|'expired'|'not_recorded'='not_recorded';if(warrantyEnd){const days=(warrantyEnd.getTime()-asOf.getTime())/86400000;warrantyStatus=days<0?'expired':days<=90?'expiring_soon':'active';}
   warrantyCounts[warrantyStatus==='expiring_soon'?'expiringSoon':warrantyStatus==='not_recorded'?'notRecorded':warrantyStatus]++;
   const maintenance=(costs.get(a._id.toString())||[]).map(x=>({...x,total:x.labor+x.external+x.parts}));const byCurrency=[{currency,acquisitionCost:purchase,accumulatedDepreciation:accumulated,netBookValue:nbv},...maintenance.map(x=>({currency:x.currency,maintenanceCost:x.total}))];
   const base=totals.get(currency)||{acquisitionCost:0,netBookValue:0,maintenanceCost:0,tco:0};base.acquisitionCost+=purchase;base.netBookValue+=nbv;totals.set(currency,base);
   for(const x of maintenance){const t=totals.get(x.currency)||{acquisitionCost:0,netBookValue:0,maintenanceCost:0,tco:0};t.maintenanceCost+=x.total;totals.set(x.currency,t);}
   return{...a,financial:{depreciationMethod:'straight_line',depreciationStartDate:start||null,elapsedUsefulLifeMonths:Math.round(elapsed*100)/100,accumulatedDepreciation:Math.round(accumulated*100)/100,netBookValue:Math.round(nbv*100)/100,remainingDepreciableValue:Math.round(Math.max(0,nbv-salvage)*100)/100,maintenanceCostByCurrency:maintenance.map(x=>({...x,labor:Math.round(x.labor*100)/100,external:Math.round(x.external*100)/100,parts:Math.round(x.parts*100)/100,total:Math.round(x.total*100)/100})),warrantyStatus,daysUntilWarrantyExpiry:warrantyEnd?Math.ceil((warrantyEnd.getTime()-asOf.getTime())/86400000):null,maintenanceCost:maintenance.length===1?maintenance[0].total:null,tcoByCurrency:maintenance.map(x=>({currency:x.currency,total:Math.round(x.total*100)/100})).concat([{currency, total:Math.round((purchase+maintenance.filter(x=>x.currency===currency).reduce((sum,x)=>sum+x.total,0))*100)/100}])}};
  });
  for(const v of totals.values())v.tco=v.acquisitionCost+v.maintenanceCost;
  res.status(200).json({data:{asOf,assetCount:rows.length,assets:rows,warranty:warrantyCounts,portfolioByCurrency:[...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([currency,v])=>({currency,...Object.fromEntries(Object.entries(v).map(([k,n])=>[k,Math.round(n*100)/100]))})),methodology:{depreciation:'Straight-line book depreciation: (acquisition cost minus salvage value) divided by useful life in months, prorated by elapsed calendar time and capped at depreciable basis. Assets without a useful life have no calculated depreciation.',tco:'Acquisition cost plus completed work-order labor, external service and linked spare-part issue cost. Components remain grouped by currency; no exchange-rate conversion, tax, financing, disposal proceeds or overhead is included.',warranty:'Expiry is evaluated as of the requested date. Expiring soon means 0–90 days remaining. Missing expiry dates are not recorded.'}}});
 }catch(error){next(error);}
});
