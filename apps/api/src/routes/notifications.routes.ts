import {Router,type Request} from 'express';
import {Types} from 'mongoose';
import {z} from 'zod';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {Notification} from '../models/notification.model.js';
import {WorkOrder} from '../models/work-order.model.js';
import {VendorContract} from '../models/vendor-contract.model.js';
import {AssetAlert} from '../models/asset-alert.model.js';
import {User} from '../models/user.model.js';
export const notificationsRouter=Router();
notificationsRouter.use(authenticate);
const claims=(req:Request):AccessClaims=>req.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const manager=(c:AccessClaims)=>admin(c)||c.role==='manager';
function scope(c:AccessClaims){const f:Record<string,unknown>={tenantId:new Types.ObjectId(c.tenantId),userId:new Types.ObjectId(c.sub)};return f;}
async function enqueue(input:{tenantId:Types.ObjectId;userId:Types.ObjectId;facilityId?:Types.ObjectId;category:'sla'|'contract'|'asset_alert';title:string;message:string;severity:'warning'|'critical';resourceType:'work_order'|'vendor_contract'|'asset_alert';resourceId:Types.ObjectId;dedupeKey:string}){
 try{await Notification.updateOne({tenantId:input.tenantId,userId:input.userId,dedupeKey:input.dedupeKey},{$setOnInsert:input},{upsert:true});}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&(error as {code?:number}).code===11000))throw error;}
}
notificationsRouter.get('/',async(req,res,next)=>{try{
 const c=claims(req);const page=Math.max(1,Math.min(10000,Number(req.query.page)||1));const limit=Math.max(1,Math.min(50,Number(req.query.limit)||20));
 const filter=scope(c);if(req.query.unread==='true')filter.readAt={$exists:false};
 const [items,total,unread]=await Promise.all([Notification.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),Notification.countDocuments(filter),Notification.countDocuments({...scope(c),readAt:{$exists:false}})]);
 res.status(200).json({data:{notifications:items,total,unread,page,limit}});
 }catch(e){next(e);}});
notificationsRouter.patch('/:notificationId/read',async(req,res,next)=>{try{
 const id=String(req.params.notificationId??'');if(!Types.ObjectId.isValid(id)){res.status(404).json({error:{code:'NOTIFICATION_NOT_FOUND'}});return;}
 const item=await Notification.findOneAndUpdate({...scope(claims(req)),_id:new Types.ObjectId(id)},{$set:{readAt:new Date()}},{new:true});
 if(!item){res.status(404).json({error:{code:'NOTIFICATION_NOT_FOUND'}});return;}res.status(200).json({data:{notification:item}});
 }catch(e){next(e);}});
notificationsRouter.patch('/read-all',async(req,res,next)=>{try{
 const result=await Notification.updateMany({...scope(claims(req)),readAt:{$exists:false}},{$set:{readAt:new Date()}});
 res.status(200).json({data:{updated:result.modifiedCount}});
 }catch(e){next(e);}});
notificationsRouter.post('/dispatch',async(req,res,next)=>{try{
 const c=claims(req);if(!manager(c)){res.status(403).json({error:{code:'FORBIDDEN'}});return;}
 const now=new Date(),soon=new Date(now.getTime()+24*60*60*1000),tenantId=new Types.ObjectId(c.tenantId);
 const facilityFilter=admin(c)?{}:{facilityId:{$in:c.facilityIds.map(x=>new Types.ObjectId(x))}};
 const orders=await WorkOrder.find({tenantId,...facilityFilter,status:{$in:['open','assigned','in_progress']},assignedTo:{$exists:true,$ne:null},dueAt:{$lte:soon}}).select('_id tenantId facilityId assignedTo workOrderNumber title dueAt').limit(500).lean();
 for(const w of orders){const overdue=w.dueAt&&w.dueAt<now;await enqueue({tenantId,userId:w.assignedTo!,facilityId:w.facilityId,category:'sla',title:overdue?'Work order SLA breached':'Work order due within 24 hours',message:w.workOrderNumber+' · '+w.title+' · due '+w.dueAt!.toISOString(),severity:overdue?'critical':'warning',resourceType:'work_order',resourceId:w._id,dedupeKey:'work-order:'+w._id+':'+(overdue?'overdue':'due-soon')});}
 const contracts=await VendorContract.find({tenantId,status:'active',$expr:{$lte:['$endDate',{$dateAdd:{startDate:'$$NOW',unit:'day',amount:'$renewalNoticeDays'}}]}}).select('_id ownerUserId contractNumber title endDate renewalNoticeDays').limit(300).lean();
 for(const v of contracts){await enqueue({tenantId,userId:v.ownerUserId,category:'contract',title:'Vendor contract renewal reminder',message:v.contractNumber+' · '+v.title+' ends '+v.endDate.toISOString().slice(0,10),severity:'warning',resourceType:'vendor_contract',resourceId:v._id,dedupeKey:'contract:'+v._id+':renewal'});}
 const alerts=await AssetAlert.find({tenantId,status:'open',severity:'critical',...facilityFilter}).select('_id facilityId assetId metric message').limit(300).lean();
 let alertCount=0;
 for(const a of alerts){const recipients=await User.find({tenantId,status:'active',role:{$in:['owner','admin','manager']},facilityIds:a.facilityId}).select('_id').limit(50).lean();for(const u of recipients){await enqueue({tenantId,userId:u._id,facilityId:a.facilityId,category:'asset_alert',title:'Critical asset alert requires attention',message:a.message,severity:'critical',resourceType:'asset_alert',resourceId:a._id,dedupeKey:'critical-alert:'+a._id});alertCount++;}}
 res.status(200).json({data:{workOrdersScanned:orders.length,contractsScanned:contracts.length,criticalAlertsScanned:alerts.length,notificationsUpserted:orders.length+contracts.length+alertCount}});
 }catch(e){next(e);}});
