import {Types} from 'mongoose';
import {BackgroundJob,type BackgroundJobType} from '../models/background-job.model.js';
export async function enqueueBackgroundJob(input:{tenantId:Types.ObjectId;type:BackgroundJobType;dedupeKey:string;payload?:{facilityIds?:Types.ObjectId[];requestedBy?:Types.ObjectId};maxAttempts?:number;availableAt?:Date}){
 try{
  return await BackgroundJob.findOneAndUpdate({tenantId:input.tenantId,dedupeKey:input.dedupeKey},{$setOnInsert:{...input,status:'queued',attempts:0,maxAttempts:input.maxAttempts??5,availableAt:input.availableAt??new Date()}},{upsert:true,new:true});
 }catch(error){if(error&&typeof error==='object'&&'code'in error&&(error as {code?:number}).code===11000)return BackgroundJob.findOne({tenantId:input.tenantId,dedupeKey:input.dedupeKey});throw error;}
}
export async function claimBackgroundJob(workerId:string,leaseMs=120000){
 const now=new Date();
 return BackgroundJob.findOneAndUpdate({$or:[{status:'queued',availableAt:{$lte:now},$expr:{$lt:['$attempts','$maxAttempts']}},{status:'running',lockExpiresAt:{$lte:now},$expr:{$lt:['$attempts','$maxAttempts']}}]},{$set:{status:'running',lockedAt:now,lockExpiresAt:new Date(now.getTime()+leaseMs),lockedBy:workerId},$inc:{attempts:1},$unset:{lastError:1}},{sort:{availableAt:1,createdAt:1},new:true});
}
export async function completeBackgroundJob(id:Types.ObjectId,workerId:string){
 await BackgroundJob.updateOne({_id:id,status:'running',lockedBy:workerId},{$set:{status:'completed',completedAt:new Date()},$unset:{lockedAt:1,lockExpiresAt:1,lockedBy:1,lastError:1}});
}
export async function failBackgroundJob(id:Types.ObjectId,workerId:string,error:unknown,attempts:number,maxAttempts:number){
 const message=(error instanceof Error?error.message:String(error)).slice(0,1900);
 const terminal=attempts>=maxAttempts;
 const delay=Math.min(60*60*1000,1000*2**Math.min(attempts,10));
 await BackgroundJob.updateOne({_id:id,status:'running',lockedBy:workerId},{$set:{status:terminal?'failed':'queued',lastError:message,availableAt:new Date(Date.now()+delay)},$unset:{lockedAt:1,lockExpiresAt:1,lockedBy:1}});
}
