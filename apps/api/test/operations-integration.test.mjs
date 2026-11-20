import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_TOKEN_SECRET = 'forgeops-operations-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL = '15m';
process.env.AUTH_REFRESH_TOKEN_DAYS = '14';

let mongod;
let mongoose;
let app;
let Tenant;
let User;
let Facility;
let Asset;
let AuditEvent;
let signAccessToken;
let server;
let baseUrl;

const registration = (slug, email) => ({
  organizationName: 'ForgeOps Test Organization',
  organizationSlug: slug,
  firstName: 'Test',
  lastName: 'Owner',
  email,
  password: 'A-Strong-Password-2026!'
});

async function post(path, body, token) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function get(path, token) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

before(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('forgeops-operations-integration');

  const [mongooseModule, appModule, tenantModule, userModule, facilityModule, assetModule, auditModule, tokenModule] = await Promise.all([
    import('mongoose'),
    import('../src/app.ts'),
    import('../src/models/tenant.model.ts'),
    import('../src/models/user.model.ts'),
    import('../src/models/facility.model.ts'),
    import('../src/models/asset.model.ts'),
    import('../src/models/audit-event.model.ts'),
    import('../src/auth/token.service.ts')
  ]);

  mongoose = mongooseModule.default;
  app = appModule.app;
  Tenant = tenantModule.Tenant;
  User = userModule.User;
  Facility = facilityModule.Facility;
  Asset = assetModule.Asset;
  AuditEvent = auditModule.AuditEvent;
  signAccessToken = tokenModule.signAccessToken;

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Tenant.init(), User.init(), Facility.init(), Asset.init(), AuditEvent.init()]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Facility.deleteMany({}),
    Asset.deleteMany({}),
    AuditEvent.deleteMany({})
  ]);
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (mongoose) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('facility and asset lifecycle APIs enforce tenant isolation and emit audit events', async () => {
  const ownerAResponse = await post('/api/v1/auth/register', registration('northstar', 'owner-a@example.com'));
  const ownerA = (await ownerAResponse.json()).data;
  const ownerBResponse = await post('/api/v1/auth/register', registration('contoso', 'owner-b@example.com'));
  const ownerB = (await ownerBResponse.json()).data;

  const facilityResponse = await post('/api/v1/operations/facilities', {
    code: 'PLANT-01',
    name: 'Northstar Main Plant',
    facilityType: 'manufacturing',
    timezone: 'Asia/Kolkata',
    address: { city: 'Kolkata', country: 'India' }
  }, ownerA.accessToken);
  const facilityPayload = await facilityResponse.json();
  assert.equal(facilityResponse.status, 201);
  const facilityId = facilityPayload.data.facility._id;

  const assetResponse = await post('/api/v1/operations/assets', {
    facilityId,
    assetTag: 'PUMP-001',
    name: 'Cooling Water Pump',
    category: 'rotating-equipment',
    manufacturer: 'Acme Industrial',
    modelNumber: 'CW-450',
    serialNumber: 'CW450-0001',
    criticality: 'critical',
    lifecycleStatus: 'operational',
    condition: 'good',
    purchaseCost: 12500,
    currency: 'INR'
  }, ownerA.accessToken);
  const assetPayload = await assetResponse.json();
  assert.equal(assetResponse.status, 201);
  const assetId = assetPayload.data.asset._id;

  // Optional serial numbers must not collide through a sparse compound index.
  const assetWithoutSerial = await post('/api/v1/operations/assets', {
    facilityId,
    assetTag: 'VALVE-002',
    name: 'Pressure Isolation Valve',
    category: 'valves'
  }, ownerA.accessToken);
  assert.equal(assetWithoutSerial.status, 201);

  const list = await get('/api/v1/operations/assets?q=PUMP-001&criticality=critical', ownerA.accessToken);
  const listPayload = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listPayload.data.pagination.total, 1);
  assert.equal(listPayload.data.assets[0].assetTag, 'PUMP-001');

  const crossTenantGet = await get(`/api/v1/operations/assets/${assetId}`, ownerB.accessToken);
  assert.equal(crossTenantGet.status, 404);
  const crossTenantList = await get('/api/v1/operations/assets', ownerB.accessToken);
  assert.equal((await crossTenantList.json()).data.pagination.total, 0);

  const update = await fetch(`${baseUrl}/api/v1/operations/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerA.accessToken}` },
    body: JSON.stringify({ lifecycleStatus: 'maintenance', condition: 'fair' })
  });
  assert.equal(update.status, 200);

  const audit = await get(`/api/v1/operations/assets/${assetId}/audit`, ownerA.accessToken);
  const auditPayload = await audit.json();
  assert.equal(audit.status, 200);
  assert.equal(auditPayload.data.events.length, 2);
  assert.deepEqual(auditPayload.data.events.map((event) => event.action).sort(), ['created', 'updated']);

  const archive = await fetch(`${baseUrl}/api/v1/operations/assets/${assetId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${ownerA.accessToken}` }
  });
  assert.equal(archive.status, 204);
  assert.equal(await Asset.countDocuments({ _id: assetId, archivedAt: null }), 0);
  assert.equal(await AuditEvent.countDocuments({ entityId: assetId, action: 'archived' }), 1);
});

test('manager access is constrained to facilities assigned in the verified token', async () => {
  const ownerResponse = await post('/api/v1/auth/register', registration('scope-org', 'scope-owner@example.com'));
  const owner = (await ownerResponse.json()).data;
  const facilityResponse = await post('/api/v1/operations/facilities', {
    code: 'SITE-02',
    name: 'Restricted Site',
    facilityType: 'warehouse'
  }, owner.accessToken);
  assert.equal(facilityResponse.status, 201);
  const facilityId = (await facilityResponse.json()).data.facility._id;

  const ownerUser = await User.findOne({ email: 'scope-owner@example.com' });
  const manager = await User.create({
    tenantId: ownerUser.tenantId,
    email: 'manager@example.com',
    passwordHash: 'not-used-in-this-token-only-test',
    firstName: 'Morgan',
    lastName: 'Manager',
    role: 'manager',
    facilityIds: []
  });
  const managerToken = signAccessToken({
    sub: manager._id.toString(),
    tenantId: manager.tenantId.toString(),
    role: 'manager',
    facilityIds: []
  });

  const forbiddenCreate = await post('/api/v1/operations/assets', {
    facilityId,
    assetTag: 'SCOPE-001',
    name: 'Restricted Asset',
    category: 'equipment'
  }, managerToken);
  assert.equal(forbiddenCreate.status, 403);

  const invisibleFacilities = await get('/api/v1/operations/facilities', managerToken);
  assert.equal((await invisibleFacilities.json()).data.facilities.length, 0);
});
