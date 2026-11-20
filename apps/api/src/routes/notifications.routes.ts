import {Router,type Request} from 'express';
import {randomUUID} from 'node:crypto';
import {Types} from 'mongoose';
import type {AccessClaims} from '../auth/token.service.js';
import {authenticate} from '../middleware/authenticate.js';
import {Notification} from '../models/notification.model.js';
import {BackgroundJob} from '../models/background-job.model.js';
import {enqueueBackgroundJob} from '../services/background-jobs.service.js';
export const notificationsRouter=Router();
notificationsRouter.use(authenticate);
const claims=(req:Request):AccessClaims=>req.auth!;
const admin=(c:AccessClaims)=>c.role==='owner'||c.role==='admin';
const manager=(c:AccessClaims)=>admin(c)||c.role==='manager';
function scope(c:AccessClaims){return {tenantId:new Types.ObjectId(c.tenantId),userId:new Types.ObjectId(c.sub)};}
notificationsRouter.get('/',async(req,res,next)=>{try{
 const c=claims(req),page=Math.max(1,Math.min(10000,Number(req.query.page)||1)),limit=Math.max(1,Math.min(50,Number(req.query.limit)||20));
 const filter:Record<string,unknown>=scope(c);if(req.query.unread==='true')filter.readAt={$exists:false};
 const [items,total,unread]=await Promise.all([Notification.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),Notification.countDocuments(filter),Notification.countDocuments({...scope(c),readAt:{$exists:false}})]);
 res.status(200).json({data:{notifications:items,total,unread,page,limit}});
 }catch(e){next(e);}});
notificationsRouter.patch('/read-all',async(req,res,next)=>{try{
 const result=await Notification.updateMany({...scope(claims(req)),readAt:{$exists:false}},{$set:{readAt:new Date()}});
 res.status(200).json({data:{updated:result.modifiedCount}});
 }catch(e){next(e);}});
notificationsRouter.post('/dispatch',async(req,res,next)=>{try{
 const c=claims(req);if(!manager(c)){res.status(403).json({error:{code:'FORBIDDEN'}});return;}
 const tenantId=new Types.ObjectId(c.tenantId),requestedBy=new Types.ObjectId(c.sub);
 const payload=admin(c)?{requestedBy}:{requestedBy,facilityIds:c.facilityIds.map(id=>new Types.ObjectId(id))};
 const job=await enqueueBackgroundJob({tenantId,type:'operations_scan',dedupeKey:'manual-operations-scan:'+requestedBy+':'+randomUUID(),payload,maxAttempts:5});
 res.status(202).json({data:{job:{id:job?._id,status:job?.status,availableAt:job?.availableAt},message:'Operations scan queued for background processing.'}});
 }catch(e){next(e);}});
notificationsRouter.get('/dispatch/:jobId',async(req,res,next)=>{try{
 const c=claims(req),id=String(req.params.jobId??'');if(!Types.ObjectId.isValid(id)){res.status(404).json({error:{code:'JOB_NOT_FOUND'}});return;}
 const job=await BackgroundJob.findOne({_id:new Types.ObjectId(id),tenantId:new Types.ObjectId(c.tenantId),'payload.requestedBy':new Types.ObjectId(c.sub)}).select('status attempts maxAttempts availableAt startedAt completedAt createdAt').lean();
 if(!job){res.status(404).json({error:{code:'JOB_NOT_FOUND'}});return;}
 res.status(200).json({data:{job}});
 }catch(e){next(e);}});
notificationsRouter.patch('/:notificationId/read',async(req,res,next)=>{try{
 const id=String(req.params.notificationId??'');if(!Types.ObjectId.isValid(id)){res.status(404).json({error:{code:'NOTIFICATION_NOT_FOUND'}});return;}
 const item=await Notification.findOneAndUpdate({...scope(claims(req)),_id:new Types.ObjectId(id)},{$set:{readAt:new Date()}},{new:true});
 if(!item){res.status(404).json({error:{code:'NOTIFICATION_NOT_FOUND'}});return;}res.status(200).json({data:{notification:item}});
 }catch(e){next(e);}});
