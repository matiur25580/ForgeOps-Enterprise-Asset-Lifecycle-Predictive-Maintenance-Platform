import {Types} from 'mongoose';
import {Notification} from '../models/notification.model.js';
import {WorkOrder} from '../models/work-order.model.js';
import {VendorContract} from '../models/vendor-contract.model.js';
import {AssetAlert} from '../models/asset-alert.model.js';
import {User} from '../models/user.model.js';
async function createNotification(input:{tenantId:Types.ObjectId;userId:Types.ObjectId;facilityId?:Types.ObjectId;category:'sla'|'contract'|'asset_alert';title:string;message:string;severity:'warning'|'critical';resourceType:'work_order'|'vendor_contract'|'asset_alert';resourceId:Types.ObjectId;dedupeKey:string}){
 try{const result=await Notification.updateOne({tenantId:input.tenantId,userId:input.userId,dedupeKey:input.dedupeKey},{$setOnInsert:input},{upsert:true});return result.upsertedCount??0;}
 catch(error){if(error&&typeof error==='object'&&'code'in error&&(error as {code?:number}).code===11000)return 0;throw error;}
}
export async function runOperationsScan(tenantIdValue:string,facilityIds?:string[]){
 const tenantId=new Types.ObjectId(tenantIdValue),now=new Date(),soon=new Date(now.getTime()+24*60*60*1000);
 const facilityFilter=facilityIds?{facilityId:{$in:facilityIds.map(id=>new Types.ObjectId(id))}}:{};
 const orders=await WorkOrder.find({tenantId,...facilityFilter,status:{$in:['open','assigned','in_progress']},assignedTo:{$exists:true,$ne:null},dueAt:{$lte:soon}}).select('_id facilityId assignedTo workOrderNumber title dueAt').limit(500).lean();
 let created=0;
 for(const w of orders){if(!w.dueAt||!w.assignedTo)continue;const overdue=w.dueAt<now;created+=await createNotification({tenantId,userId:w.assignedTo,facilityId:w.facilityId,category:'sla',title:overdue?'Work order SLA breached':'Work order due within 24 hours',message:w.workOrderNumber+' · '+w.title+' · due '+w.dueAt.toISOString(),severity:overdue?'critical':'warning',resourceType:'work_order',resourceId:w._id,dedupeKey:'work-order:'+w._id+':'+(overdue?'overdue':'due-soon')+':'+w.dueAt.toISOString()});}
 const contracts=await VendorContract.find({tenantId,status:'active',endDate:{$gte:now,$lte:new Date(now.getTime()+730*86400000)}}).select('_id ownerUserId contractNumber title endDate renewalNoticeDays').limit(500).lean();
 let contractCount=0;
 for(const v of contracts){if(v.endDate.getTime()-now.getTime()>v.renewalNoticeDays*86400000)continue;contractCount+=await createNotification({tenantId,userId:v.ownerUserId,category:'contract',title:'Vendor contract renewal reminder',message:v.contractNumber+' · '+v.title+' ends '+v.endDate.toISOString().slice(0,10),severity:'warning',resourceType:'vendor_contract',resourceId:v._id,dedupeKey:'contract:'+v._id+':renewal:'+v.endDate.toISOString().slice(0,10)});}
 const alerts=await AssetAlert.find({tenantId,status:'open',severity:'critical',...facilityFilter}).select('_id facilityId message').limit(300).lean();
 let alertCount=0;
 for(const a of alerts){const recipients=await User.find({tenantId,status:'active',$or:[{role:{$in:['owner','admin']}},{role:'manager',facilityIds:a.facilityId}]}).select('_id').limit(50).lean();for(const u of recipients){alertCount+=await createNotification({tenantId,userId:u._id,facilityId:a.facilityId,category:'asset_alert',title:'Critical asset alert requires attention',message:a.message,severity:'critical',resourceType:'asset_alert',resourceId:a._id,dedupeKey:'critical-alert:'+a._id});}}
 return {workOrdersScanned:orders.length,contractsScanned:contracts.length,criticalAlertsScanned:alerts.length,notificationsCreated:created+contractCount+alertCount};
}
