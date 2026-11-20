import {Router} from 'express';
import {z} from 'zod';
import {Types} from 'mongoose';
import {authenticate} from '../middleware/authenticate.js';
import {NotificationPreference} from '../models/notification-preference.model.js';
import {NotificationDelivery} from '../models/notification-delivery.model.js';
import {NotificationEscalationPolicy} from '../models/notification-escalation-policy.model.js';
import {emailTransportConfigured} from '../services/email.service.js';
export const notificationSettingsRouter=Router();
notificationSettingsRouter.use(authenticate);
const preferenceSchema=z.object({emailEnabled:z.boolean(),categories:z.object({sla:z.boolean(),contract:z.boolean(),asset_alert:z.boolean(),maintenance:z.boolean()}),quietHoursEnabled:z.boolean(),quietHoursStart:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),quietHoursEnd:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),timezone:z.string().min(1).max(80)}).superRefine((v,ctx)=>{if(v.quietHoursEnabled&&(!v.quietHoursStart||!v.quietHoursEnd))ctx.addIssue({code:'custom',message:'Both quiet-hour times are required.'});try{new Intl.DateTimeFormat('en',{timeZone:v.timezone});}catch{ctx.addIssue({code:'custom',message:'Timezone must be a valid IANA timezone.'});}});
function scope(req:any){return {tenantId:new Types.ObjectId(req.auth.tenantId),userId:new Types.ObjectId(req.auth.sub)};}
notificationSettingsRouter.get('/preferences',async(req,res,next)=>{try{const value=await NotificationPreference.findOne(scope(req)).lean();res.status(200).json({data:{preferences:value??{emailEnabled:false,categories:{sla:true,contract:true,asset_alert:true,maintenance:true},quietHoursEnabled:false,timezone:'UTC'},emailDeliveryConfigured:emailTransportConfigured()}});}catch(e){next(e);}});
notificationSettingsRouter.put('/preferences',async(req,res,next)=>{try{const parsed=preferenceSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}const value=await NotificationPreference.findOneAndUpdate(scope(req),{$set:parsed.data},{upsert:true,new:true,runValidators:true});res.status(200).json({data:{preferences:value,emailDeliveryConfigured:emailTransportConfigured()}});}catch(e){next(e);}});
notificationSettingsRouter.get('/deliveries',async(req,res,next)=>{try{const page=Math.max(1,Math.min(1000,Number(req.query.page)||1)),limit=Math.max(1,Math.min(50,Number(req.query.limit)||20));const filter=scope(req);const [items,total]=await Promise.all([NotificationDelivery.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),NotificationDelivery.countDocuments(filter)]);res.status(200).json({data:{deliveries:items,total,page,limit}});}catch(e){next(e);}});

const escalationSchema=z.object({enabled:z.boolean(),overdueAfterMinutes:z.number().int().min(15).max(10080),notifyTenantAdmins:z.boolean(),notifyFacilityManagers:z.boolean()});
notificationSettingsRouter.get('/escalation-policy',async(req,res,next)=>{try{
 const role=req.auth!.role;if(!['owner','admin','manager'].includes(role)){res.status(403).json({error:{code:'FORBIDDEN'}});return;}
 const tenantId=new Types.ObjectId(req.auth!.tenantId),value=await NotificationEscalationPolicy.findOne({tenantId}).lean();
 res.status(200).json({data:{policy:value??{enabled:true,overdueAfterMinutes:240,notifyTenantAdmins:true,notifyFacilityManagers:true}}});
}catch(e){next(e);}});
notificationSettingsRouter.put('/escalation-policy',async(req,res,next)=>{try{
 if(!['owner','admin'].includes(req.auth!.role)){res.status(403).json({error:{code:'FORBIDDEN'}});return;}
 const parsed=escalationSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});return;}
 const tenantId=new Types.ObjectId(req.auth!.tenantId),value=await NotificationEscalationPolicy.findOneAndUpdate({tenantId},{$set:parsed.data},{upsert:true,new:true,runValidators:true});
 res.status(200).json({data:{policy:value}});
}catch(e){next(e);}});
