import test, {before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-alert-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL='15m';
process.env.AUTH_REFRESH_TOKEN_DAYS='14';

let mongod,mongoose,Tenant,server,baseUrl,token,facilityId,assetId;
async function request(path,{method='GET',body,auth=token}={}){
 const response=await fetch(baseUrl+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {response,payload:response.status===204?null:await response.json()};
}
before(async()=>{
 const {MongoMemoryServer}=await import('mongodb-memory-server');
 mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri('forgeops-alerts');
 const [mm,app,tenant]=await Promise.all([import('mongoose'),import('../src/app.ts'),import('../src/models/tenant.model.ts')]);
 mongoose=mm.default;Tenant=tenant.Tenant;await mongoose.connect(process.env.MONGODB_URI);
 server=app.app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 baseUrl='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
 await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));
 const reg=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Alert Test Co',organizationSlug:'alert-test',firstName:'Alex',lastName:'Owner',email:'owner@alert.test',password:'A-Strong-Password-2026!'}});
 assert.equal(reg.response.status,201);token=reg.payload.data.accessToken;
 const f=await request('/api/v1/operations/facilities',{method:'POST',body:{code:'PLANT-A',name:'Alert Plant',facilityType:'manufacturing',timezone:'Asia/Kolkata'}});
 assert.equal(f.response.status,201);facilityId=f.payload.data.facility._id;
 const a=await request('/api/v1/operations/assets',{method:'POST',body:{facilityId,assetTag:'PUMP-A1',name:'Alert Pump',category:'rotating-equipment',criticality:'high'}});
 assert.equal(a.response.status,201);assetId=a.payload.data.asset._id;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(mongoose)await mongoose.disconnect();if(mongod)await mongod.stop();});

test('configured telemetry thresholds create alerts that can be acknowledged, linked and resolved',async()=>{
 const rule=await request('/api/v1/alerts/rules/temperature_c',{method:'PUT',body:{warningThreshold:10,criticalThreshold:20,direction:'high',enabled:true}});
 assert.equal(rule.response.status,200);
 const simulation=await request('/api/v1/telemetry/simulate',{method:'POST',body:{assetId,samples:6}});
 assert.equal(simulation.response.status,201);
 assert.equal(simulation.payload.data.alerts.created>0,true);
 const list=await request('/api/v1/alerts');
 assert.equal(list.response.status,200);
 const alert=list.payload.data.alerts.find(x=>x.metric==='temperature_c');
 assert.ok(alert);
 assert.equal(alert.severity,'critical');
 const ack=await request('/api/v1/alerts/'+alert._id+'/acknowledge',{method:'PATCH',body:{}});
 assert.equal(ack.response.status,200);assert.equal(ack.payload.data.alert.status,'acknowledged');
 const linked=await request('/api/v1/alerts/'+alert._id+'/work-order',{method:'POST',body:{}});
 assert.equal(linked.response.status,201);assert.equal(linked.payload.data.workOrder.sourceAlertId,alert._id);
 const duplicate=await request('/api/v1/alerts/'+alert._id+'/work-order',{method:'POST',body:{}});
 assert.equal(duplicate.response.status,200);assert.equal(duplicate.payload.data.alreadyLinked,true);
 const resolved=await request('/api/v1/alerts/'+alert._id+'/resolve',{method:'PATCH',body:{}});
 assert.equal(resolved.response.status,200);assert.equal(resolved.payload.data.alert.status,'resolved');
 const audits=await mongoose.connection.collection('auditevents').find({entityType:'asset_alert',entityId:alert._id}).toArray();
 assert.equal(audits.length,2);
});

test('alert rules reject invalid severity ordering and alert access is tenant scoped',async()=>{
 const invalid=await request('/api/v1/alerts/rules/pressure_bar',{method:'PUT',body:{warningThreshold:1,criticalThreshold:2,direction:'low',enabled:true}});
 assert.equal(invalid.response.status,400);
 const other=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Other Co',organizationSlug:'other-alert',firstName:'Other',lastName:'Owner',email:'other@alert.test',password:'A-Strong-Password-2026!'}});
 assert.equal(other.response.status,201);
 const hidden=await request('/api/v1/alerts',{auth:other.payload.data.accessToken});
 assert.equal(hidden.response.status,200);assert.equal(hidden.payload.data.alerts.length,0);
});
