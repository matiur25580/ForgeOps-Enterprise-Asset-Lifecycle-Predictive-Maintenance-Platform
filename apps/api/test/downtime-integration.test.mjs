import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-downtime-test-secret-never-use-in-production';process.env.AUTH_ACCESS_TOKEN_TTL='15m';process.env.AUTH_REFRESH_TOKEN_DAYS='14';
let mongod,mongoose,server,baseUrl,token,tenantId,facilityId,assetId,managerToken;
async function request(path,{method='GET',auth=token,body}={}){const response=await fetch(baseUrl+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{response,payload:response.status===204?null:await response.json()};}
before(async()=>{const {MongoMemoryServer}=await import('mongodb-memory-server');mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri('forgeops-downtime');const [mm,app]=await Promise.all([import('mongoose'),import('../src/app.ts')]);mongoose=mm.default;await mongoose.connect(process.env.MONGODB_URI);server=app.app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});baseUrl='http://127.0.0.1:'+server.address().port;});
beforeEach(async()=>{await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));const reg=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Downtime Test Co',organizationSlug:'downtime-test',firstName:'Alex',lastName:'Owner',email:'owner@downtime.test',password:'A-Strong-Password-2026!'}});assert.equal(reg.response.status,201);token=reg.payload.data.accessToken;const authPayload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());tenantId=authPayload.tenantId;const f=await request('/api/v1/operations/facilities',{method:'POST',body:{code:'DT-PLANT',name:'Downtime Plant',facilityType:'manufacturing',timezone:'Asia/Kolkata'}});assert.equal(f.response.status,201);facilityId=f.payload.data.facility._id;const a=await request('/api/v1/operations/assets',{method:'POST',body:{facilityId,assetTag:'DT-PUMP-1',name:'Downtime Pump',category:'rotating-equipment',criticality:'high',scheduledOperatingHoursPerWeek:168}});assert.equal(a.response.status,201);assetId=a.payload.data.asset._id;});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(mongoose)await mongoose.disconnect();if(mongod)await mongod.stop();});
test('downtime lifecycle prevents duplicate open events and requires independent verification',async()=>{
 const startedAt=new Date(Date.now()-3*3600000).toISOString();
 const created=await request('/api/v1/downtime/events',{method:'POST',body:{assetId,cause:'breakdown',title:'Pump bearing failure',description:'Abnormal bearing temperature',startedAt}});
 assert.equal(created.response.status,201);const eventId=created.payload.data.event._id;
 const duplicate=await request('/api/v1/downtime/events',{method:'POST',body:{assetId,cause:'other',title:'Duplicate event',startedAt}});
 assert.equal(duplicate.response.status,409);assert.equal(duplicate.payload.error.code,'ASSET_ALREADY_IN_DOWNTIME');
 const resolved=await request('/api/v1/downtime/events/'+eventId+'/resolve',{method:'PATCH',body:{endedAt:new Date(Date.now()-3600000).toISOString()}});
 assert.equal(resolved.response.status,200);assert.equal(resolved.payload.data.event.status,'resolved');
 const selfVerify=await request('/api/v1/downtime/events/'+eventId+'/verify',{method:'PATCH',body:{decision:'verified'}});
 assert.equal(selfVerify.response.status,403);assert.equal(selfVerify.payload.error.code,'SELF_VERIFICATION_FORBIDDEN');
 const {User}=await import('../src/models/user.model.ts');const {Types}=await import('mongoose');const {signAccessToken}=await import('../src/auth/token.service.ts');
 const manager=await User.create({tenantId:new Types.ObjectId(tenantId),email:'manager@downtime.test',passwordHash:'not-used-for-bearer-test',firstName:'Morgan',lastName:'Manager',role:'manager',facilityIds:[new Types.ObjectId(facilityId)],status:'active'});
 managerToken=signAccessToken({sub:manager._id.toString(),tenantId,role:'manager',facilityIds:[facilityId]});
 const verified=await request('/api/v1/downtime/events/'+eventId+'/verify',{method:'PATCH',auth:managerToken,body:{decision:'verified',notes:'Maintenance log and operator report checked.'}});
 assert.equal(verified.response.status,200);assert.equal(verified.payload.data.event.verificationStatus,'verified');
 const summary=await request('/api/v1/analytics/summary');assert.equal(summary.response.status,200);assert.equal(summary.payload.data.availability.measuredAssets,1);assert.ok(summary.payload.data.availability.verifiedDowntimeMinutes>0);assert.ok(summary.payload.data.availability.availabilityPercent<100);
 const events=await request('/api/v1/downtime/events?verificationStatus=verified');assert.equal(events.response.status,200);assert.equal(events.payload.data.events.length,1);
});
test('downtime events are tenant isolated and invalid ranges are rejected',async()=>{
 const other=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Other Downtime Co',organizationSlug:'other-downtime',firstName:'Other',lastName:'Owner',email:'other@downtime.test',password:'A-Strong-Password-2026!'}});
 assert.equal(other.response.status,201);
 const hidden=await request('/api/v1/downtime/events',{auth:other.payload.data.accessToken});assert.equal(hidden.response.status,200);assert.equal(hidden.payload.data.events.length,0);
 const bad=await request('/api/v1/analytics/summary?from=bad&to=2026-11-20');assert.equal(bad.response.status,400);
});
