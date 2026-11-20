import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-inventory-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL='15m';process.env.AUTH_REFRESH_TOKEN_DAYS='14';
let mongod,mongoose,server,baseUrl,token,facilityId,assetId;
async function request(path,{method='GET',body,auth=token}={}){const r=await fetch(baseUrl+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{response:r,payload:r.status===204?null:await r.json()};}
before(async()=>{
 const {MongoMemoryServer}=await import('mongodb-memory-server');mongod=await MongoMemoryServer.create();process.env.MONGODB_URI=mongod.getUri('forgeops-inventory');
 const [mm,am]=await Promise.all([import('mongoose'),import('../src/app.ts')]);mongoose=mm.default;await mongoose.connect(process.env.MONGODB_URI);
 await Promise.all(Object.values(mongoose.connection.models).map(m=>m.init()));
 server=am.app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});baseUrl='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
 await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));
 const auth=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Inventory Test Co',organizationSlug:'inventory-test',firstName:'Alex',lastName:'Admin',email:'admin@example.com',password:'A-Strong-Password-2026!'}});
 assert.equal(auth.response.status,201);token=auth.payload.data.accessToken;
 const f=await request('/api/v1/operations/facilities',{method:'POST',body:{code:'PLANT-01',name:'Main Plant',facilityType:'manufacturing'}});assert.equal(f.response.status,201);facilityId=f.payload.data.facility._id;
 const a=await request('/api/v1/operations/assets',{method:'POST',body:{facilityId,assetTag:'PUMP-01',name:'Cooling Pump',category:'rotating-equipment'}});assert.equal(a.response.status,201);assetId=a.payload.data.asset._id;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(mongoose)await mongoose.disconnect();if(mongod)await mongod.stop();});
test('vendor, spare part, receipt and issue maintain a traceable facility stock ledger',async()=>{
 const v=await request('/api/v1/inventory/vendors',{method:'POST',body:{vendorCode:'ACME-01',name:'Acme Industrial Supply',email:'sales@acme.example',paymentTerms:'Net 30'}});
 assert.equal(v.response.status,201);const vendorId=v.payload.data.vendor._id;
 const p=await request('/api/v1/inventory/parts',{method:'POST',body:{partNumber:'FLT-100',name:'Pump filter cartridge',category:'filtration',unitOfMeasure:'each',unitCost:18.5,currency:'USD',preferredVendorId:vendorId}});
 assert.equal(p.response.status,201);const sparePartId=p.payload.data.part._id;
 const receipt=await request('/api/v1/inventory/movements',{method:'POST',body:{facilityId,sparePartId,movementType:'receipt',quantity:12,reason:'Initial purchase receipt',vendorId,reference:'PO-1001',reorderPoint:4,binLocation:'A-03-02'}});
 assert.equal(receipt.response.status,201);assert.equal(receipt.payload.data.balance.onHand,12);
 const work=await request('/api/v1/maintenance/work-orders',{method:'POST',body:{facilityId,assetId,title:'Replace pump filter',type:'corrective',priority:'medium'}});
 assert.equal(work.response.status,201);
 const issue=await request('/api/v1/inventory/movements',{method:'POST',body:{facilityId,sparePartId,movementType:'issue',quantity:3,reason:'Parts consumed during work order',workOrderId:work.payload.data.workOrder._id}});
 assert.equal(issue.response.status,201);assert.equal(issue.payload.data.balance.onHand,9);
 const balance=await request('/api/v1/inventory/balances?facilityId='+facilityId);
 assert.equal(balance.response.status,200);assert.equal(balance.payload.data.balances[0].onHand,9);
 const ledger=await request('/api/v1/inventory/movements?facilityId='+facilityId);
 assert.equal(ledger.response.status,200);assert.equal(ledger.payload.data.movements.length,2);
 const insufficient=await request('/api/v1/inventory/movements',{method:'POST',body:{facilityId,sparePartId,movementType:'issue',quantity:10,reason:'Attempt to issue more than available'}});
 assert.equal(insufficient.response.status,409);assert.equal(insufficient.payload.error.code,'INSUFFICIENT_STOCK');
});
test('inventory operations reject facility and vendor references outside tenant scope',async()=>{
 const foreign=await request('/api/v1/auth/register',{method:'POST',auth:null,body:{organizationName:'Other Org',organizationSlug:'other-org',firstName:'Other',lastName:'Owner',email:'owner@other.example',password:'A-Strong-Password-2026!'}});
 const otherToken=foreign.payload.data.accessToken;
 const created=await request('/api/v1/inventory/parts',{method:'POST',auth:otherToken,body:{partNumber:'OTHER-1',name:'Other part',category:'general',unitCost:1}});
 assert.equal(created.response.status,201);
 const rejected=await request('/api/v1/inventory/movements',{method:'POST',body:{facilityId,sparePartId:created.payload.data.part._id,movementType:'receipt',quantity:5,reason:'Cross tenant attempt'}});
 assert.equal(rejected.response.status,404);
});
