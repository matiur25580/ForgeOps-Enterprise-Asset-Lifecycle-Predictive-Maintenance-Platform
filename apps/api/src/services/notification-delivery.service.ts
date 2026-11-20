import {Types} from 'mongoose';
import {Notification} from '../models/notification.model.js';
import {NotificationPreference} from '../models/notification-preference.model.js';
import {NotificationDelivery} from '../models/notification-delivery.model.js';
import {User} from '../models/user.model.js';
import {sendNotificationEmail,emailTransportConfigured} from './email.service.js';
function isQuietNow(start:string,end:string,timezone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const current=Number(parts.find(p=>p.type==='hour')?.value??0)*60+Number(parts.find(p=>p.type==='minute')?.value??0);
 const from=Number(start.slice(0,2))*60+Number(start.slice(3,5)),to=Number(end.slice(0,2))*60+Number(end.slice(3,5));
 return from===to?true:from<to?current>=from&&current<to:current>=from||current<to;
}
function escapeHtml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char));}
export async function deliverNotificationEmail(notificationId:string,tenantId:string){
 const id=new Types.ObjectId(notificationId),tenant=new Types.ObjectId(tenantId);
 const notification=await Notification.findOne({_id:id,tenantId:tenant}).lean();if(!notification)throw new Error('Notification does not exist in this tenant.');
 const [user,preference]=await Promise.all([User.findOne({_id:notification.userId,tenantId:tenant,status:'active'}).select('email firstName').lean(),NotificationPreference.findOne({tenantId:tenant,userId:notification.userId}).lean()]);
 const existing=await NotificationDelivery.findOne({tenantId:tenant,notificationId:id,channel:'email'});
 if(existing?.status==='sent'||existing?.status==='skipped')return;
 const delivery=existing??await NotificationDelivery.create({tenantId:tenant,notificationId:id,userId:notification.userId,channel:'email',status:'queued',attempts:0,recipient:user?.email??'unknown'});
 const skip=async(reason:string)=>{await NotificationDelivery.updateOne({_id:delivery._id},{$set:{status:'skipped',lastError:reason}});};
 if(!user){await skip('Recipient account is not active.');return;}
 if(!preference?.emailEnabled||!preference.categories[notification.category as keyof typeof preference.categories]){await skip('Email delivery is disabled by user preferences.');return;}
 if(preference.quietHoursEnabled&&preference.quietHoursStart&&preference.quietHoursEnd&&isQuietNow(preference.quietHoursStart,preference.quietHoursEnd,preference.timezone)){await skip('Suppressed by the recipient quiet-hours preference.');return;}
 if(!emailTransportConfigured()){await skip('SMTP is not configured for this deployment.');return;}
 await NotificationDelivery.updateOne({_id:delivery._id},{$set:{status:'queued',recipient:user.email},$inc:{attempts:1},$unset:{lastError:1}});
 try{
  const greeting=user.firstName?('Hello '+user.firstName+','):'Hello,';
  const text=greeting+'\n\n'+notification.title+'\n'+notification.message+'\n\nOpen ForgeOps to review this operational notification.';
  const html='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17253a"><div style="background:#101b2d;color:#fff;padding:20px 24px;font-size:20px;font-weight:700">ForgeOps <span style="font-size:11px;color:#a9c7f4">INDUSTRIAL CLOUD</span></div><div style="padding:26px;border:1px solid #e5eaf1"><p>'+escapeHtml(greeting)+'</p><p style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px">'+escapeHtml(notification.category.replace('_',' '))+' · '+escapeHtml(notification.severity)+'</p><h2 style="font-size:20px">'+escapeHtml(notification.title)+'</h2><p style="line-height:1.6">'+escapeHtml(notification.message)+'</p><p style="font-size:12px;color:#64748b">Sign in to ForgeOps to review this operational notification.</p></div><p style="font-size:11px;color:#94a3b8;text-align:center">Automated operational message · Manage your notification preferences in ForgeOps</p></div>';
  const result=await sendNotificationEmail({to:user.email,subject:'ForgeOps: '+notification.title,text,html});
  if(result.skipped){await skip('SMTP transport is unavailable.');return;}
  await NotificationDelivery.updateOne({_id:delivery._id},{$set:{status:'sent',providerMessageId:result.messageId,sentAt:new Date()},$unset:{lastError:1}});
 }catch(error){await NotificationDelivery.updateOne({_id:delivery._id},{$set:{status:'failed',lastError:(error instanceof Error?error.message:String(error)).slice(0,900)}});throw error;}
}
