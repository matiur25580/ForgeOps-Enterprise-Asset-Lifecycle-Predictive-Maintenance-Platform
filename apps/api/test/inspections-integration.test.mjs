import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-inspection-test-secret-never-use-in-production';process.env.AUTH_ACCESS_TOKEN_TTL='15m';process.env.AUTH_REFRESH_TOKEN_DAYS='14';
let mongod,mongoose,server,baseUrl,token,facilityId,assetId;
async function request(path,{method='GET',auth=token,body}={}){const response=await fetch(baseUrl+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{response,payload:response.status===204?null:await response.json()};}
before(async()=>{const {MongoMemoryServer}=await import('mongodb-memory-server');mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri('forgeops-inspections');const [mm,app]=await Promise.all([import('mongoose'),import('../src/app.ts')]);mongoose=mm.default;await mongoose.connect(process.env.MONGODB_URI);server=app.app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});baseUrl='http://127.0.0.1:'+server.address().port;});
beforeEach(async()=>{await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));const reg=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Inspection Test Co',organizationSlug:'inspection-test',firstName:'Casey',lastName:'Manager',email:'manager@inspection.test',password:'A-Strong-Password-2026!'}});assert.equal(reg.response.status,201);token=reg.payload.data.accessToken;const f=await request('/api/v1/operations/facilities',{method:'POST',body:{code:'PLANT-I',name:'Inspection Plant',facilityType:'manufacturing',timezone:'Asia/Kolkata'}});assert.equal(f.response.status,201);facilityId=f.payload.data.facility._id;const a=await request('/api/v1/operations/assets',{method:'POST',body:{facilityId,assetTag:'PUMP-I1',name:'Inspection Pump',category:'rotating-equipment',criticality:'high'}});assert.equal(a.response.status,201);assetId=a.payload.data.asset._id;});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(mongoose)await mongoose.disconnect();if(mongod)await mongod.stop();});
test('inspection template execution records failed findings and creates one corrective work order',async()=>{
 const template=await request('/api/v1/inspections/templates',{method:'POST',body:{code:'PUMP-SAFE-01',title:'Pump safety inspection',category:'safety',items:[{key:'guard_check',label:'Protective guard is secure',required:true},{key:'leak_check',label:'No fluid leakage',required:true}]}});
 assert.equal(template.response.status,201);
 const run=await request('/api/v1/inspections',{method:'POST',body:{facilityId,assetId,templateId:template.payload.data.template._id,responses:[{itemKey:'guard_check',result:'pass'},{itemKey:'leak_check',result:'fail',notes:'Oil leak observed at seal housing.'}]}});
 assert.equal(run.response.status,201);assert.equal(run.payload.data.inspection.overallResult,'fail');assert.equal(run.payload.data.inspection.findingsCount,1);
 const work=await request('/api/v1/inspections/'+run.payload.data.inspection._id+'/corrective-work-order',{method:'POST',body:{}});
 assert.equal(work.response.status,201);assert.equal(work.payload.data.workOrder.type,'corrective');assert.equal(work.payload.data.workOrder.sourceInspectionId,run.payload.data.inspection._id);
 const duplicate=await request('/api/v1/inspections/'+run.payload.data.inspection._id+'/corrective-work-order',{method:'POST',body:{}});
 assert.equal(duplicate.response.status,200);assert.equal(duplicate.payload.data.alreadyLinked,true);
 const history=await request('/api/v1/inspections');assert.equal(history.response.status,200);assert.equal(history.payload.data.summary.failed,1);
});
test('required checklist items and finding notes are enforced; tenant data is isolated',async()=>{
 const template=await request('/api/v1/inspections/templates',{method:'POST',body:{code:'ELEC-SAFE-01',title:'Electrical safety checklist',category:'compliance',items:[{key:'isolation',label:'Isolation procedure verified',required:true},{key:'labels',label:'Electrical labels legible',required:true}]}});
 assert.equal(template.response.status,201);
 const missing=await request('/api/v1/inspections',{method:'POST',body:{facilityId,assetId,templateId:template.payload.data.template._id,responses:[{itemKey:'isolation',result:'pass'}]}});
 assert.equal(missing.response.status,400);assert.equal(missing.payload.error.code,'REQUIRED_CHECKLIST_ITEM_MISSING');
 const noNotes=await request('/api/v1/inspections',{method:'POST',body:{facilityId,assetId,templateId:template.payload.data.template._id,responses:[{itemKey:'isolation',result:'fail'},{itemKey:'labels',result:'pass'}]}});
 assert.equal(noNotes.response.status,400);assert.equal(noNotes.payload.error.code,'FINDING_NOTES_REQUIRED');
 const other=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Other Inspection Co',organizationSlug:'other-inspection',firstName:'Other',lastName:'Owner',email:'other@inspection.test',password:'A-Strong-Password-2026!'}});
 assert.equal(other.response.status,201);
 const hidden=await request('/api/v1/inspections/templates',{auth:other.payload.data.accessToken});assert.equal(hidden.response.status,200);assert.equal(hidden.payload.data.templates.length,0);
});

test('recurring schedules generate due work orders, advance safely and expose compliance reports',async()=>{
 const template=await request('/api/v1/inspections/templates',{method:'POST',body:{code:'MONTHLY-SAFE-01',title:'Monthly plant safety review',category:'safety',items:[{key:'walkway',label:'Walkways are clear',required:true}]}});
 assert.equal(template.response.status,201);
 const schedule=await request('/api/v1/inspections/schedules',{method:'POST',body:{facilityId,assetId,templateId:template.payload.data.template._id,title:'Monthly pump safety',intervalDays:30,nextDueAt:new Date(Date.now()-86400000).toISOString(),priority:'high'}});
 assert.equal(schedule.response.status,201);
 const generated=await request('/api/v1/inspections/schedules/'+schedule.payload.data.schedule._id+'/generate-work-order',{method:'POST',body:{}});
 assert.equal(generated.response.status,201);assert.equal(generated.payload.data.workOrder.type,'inspection');assert.equal(generated.payload.data.workOrder.sourceInspectionScheduleId,schedule.payload.data.schedule._id);
 const early=await request('/api/v1/inspections/schedules/'+schedule.payload.data.schedule._id+'/generate-work-order',{method:'POST',body:{}});
 assert.equal(early.response.status,409);assert.equal(early.payload.error.code,'INSPECTION_NOT_DUE_YET');
 const pause=await request('/api/v1/inspections/schedules/'+schedule.payload.data.schedule._id+'/status',{method:'PATCH',body:{status:'paused'}});
 assert.equal(pause.response.status,200);assert.equal(pause.payload.data.schedule.status,'paused');
 const run=await request('/api/v1/inspections',{method:'POST',body:{facilityId,assetId,templateId:template.payload.data.template._id,responses:[{itemKey:'walkway',result:'pass'}]}});
 assert.equal(run.response.status,201);assert.equal(run.payload.data.inspection.reviewStatus,'pending');
 const selfReview=await request('/api/v1/inspections/'+run.payload.data.inspection._id+'/review',{method:'PATCH',body:{decision:'approved'}});
 assert.equal(selfReview.response.status,403);assert.equal(selfReview.payload.error.code,'SELF_REVIEW_NOT_ALLOWED');
 const report=await request('/api/v1/inspections/reports/summary');
 assert.equal(report.response.status,200);assert.equal(report.payload.data.totals.inspections,1);assert.equal(report.payload.data.passRate,100);
});
