import {randomUUID} from 'node:crypto';
import {connectDatabase,disconnectDatabase} from '../config/database.js';
import {Tenant} from '../models/tenant.model.js';
import {BackgroundJob} from '../models/background-job.model.js';
import {claimBackgroundJob,completeBackgroundJob,enqueueBackgroundJob,failBackgroundJob} from '../services/background-jobs.service.js';
import {runOperationsScan} from '../services/operations-scan.service.js';
import {deliverNotificationEmail} from '../services/notification-delivery.service.js';
const workerId='forgeops-worker-'+randomUUID();
let stopping=false;
let lastScheduleSlot='';
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
async function scheduleTenantScans(){
 const now=new Date(),slot=Math.floor(now.getTime()/(5*60*1000)).toString();
 if(slot===lastScheduleSlot)return;
 lastScheduleSlot=slot;
 const tenants=await Tenant.find({status:'active'}).select('_id').limit(5000).lean();
 for(const tenant of tenants){const active=await BackgroundJob.exists({tenantId:tenant._id,type:'operations_scan',status:{$in:['queued','running']}});if(!active)await enqueueBackgroundJob({tenantId:tenant._id,type:'operations_scan',dedupeKey:'operations-scan:'+slot});}
 const cutoff=new Date(now.getTime()-10*60*1000);
 await BackgroundJob.updateMany({status:'running',lockExpiresAt:{$lte:now},attempts:{$gte:5}},{$set:{status:'failed',lastError:'Worker lease expired after maximum attempts.'},$unset:{lockedAt:1,lockExpiresAt:1,lockedBy:1}});
 await BackgroundJob.deleteMany({status:{$in:['completed','failed']},updatedAt:{$lt:new Date(now.getTime()-30*86400000)}});
 console.info('Scheduled tenant operations scans:',tenants.length,'slot:',slot,'cutoff:',cutoff.toISOString());
}
async function processOne(){
 const job=await claimBackgroundJob(workerId,120000);if(!job)return false;
 try{
  if(job.type==='operations_scan')await runOperationsScan(job.tenantId.toString(),job.payload.facilityIds?.map(id=>id.toString()));
  else if(job.type==='notification_email'&&job.payload.notificationId)await deliverNotificationEmail(job.payload.notificationId.toString(),job.tenantId.toString());
  await completeBackgroundJob(job._id,workerId);
  console.info('Completed background job',job._id.toString(),job.type,'attempt',job.attempts);
 }catch(error){
  await failBackgroundJob(job._id,workerId,error,job.attempts,job.maxAttempts);
  console.error('Background job failed',job._id.toString(),error);
 }
 return true;
}
async function main(){
 await connectDatabase();
 console.info('ForgeOps background worker started:',workerId);
 try{
  while(!stopping){
   try{await scheduleTenantScans();const worked=await processOne();if(!worked)await sleep(2000);}
   catch(error){console.error('Worker loop error:',error);await sleep(5000);}
  }
 }finally{await disconnectDatabase();console.info('ForgeOps background worker stopped.');}
}
function stop(signal:string){console.info('Received',signal,'; worker will finish the current job and stop.');stopping=true;}
process.once('SIGINT',()=>stop('SIGINT'));
process.once('SIGTERM',()=>stop('SIGTERM'));
main().catch(error=>{console.error('Background worker failed to start:',error);process.exitCode=1;});
