import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_TOKEN_SECRET = 'forgeops-maintenance-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL = '15m';
process.env.AUTH_REFRESH_TOKEN_DAYS = '14';

let mongod, mongoose, Tenant, User, server, baseUrl;
let adminToken, facilityId, assetId, technicianId;

async function request(path, { method = 'GET', token = adminToken, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { response, payload: response.status === 204 ? null : await response.json() };
}

before(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('forgeops-maintenance');
  const [mongooseModule, appModule, tenantModule, userModule] = await Promise.all([
    import('mongoose'), import('../src/app.ts'), import('../src/models/tenant.model.ts'), import('../src/models/user.model.ts')
  ]);
  mongoose = mongooseModule.default; Tenant = tenantModule.Tenant; User = userModule.User;
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Tenant.init(), User.init()]);
  server = appModule.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
  const registration = await request('/api/v1/auth/register', { token: null, method: 'POST', body: {
    organizationName: 'Maintenance Test Co', organizationSlug: 'maint-test', firstName: 'Morgan',
    lastName: 'Manager', email: 'manager@example.com', password: 'A-Strong-Password-2026!'
  }});
  assert.equal(registration.response.status, 201);
  adminToken = registration.payload.data.accessToken;
  const facility = await request('/api/v1/operations/facilities', { method: 'POST', body: {
    code: 'PLANT-01', name: 'Main Plant', facilityType: 'manufacturing', timezone: 'Asia/Kolkata'
  }});
  assert.equal(facility.response.status, 201);
  facilityId = facility.payload.data.facility._id;
  const asset = await request('/api/v1/operations/assets', { method: 'POST', body: {
    facilityId, assetTag: 'PUMP-01', name: 'Cooling Pump', category: 'rotating-equipment', criticality: 'high'
  }});
  assert.equal(asset.response.status, 201);
  assetId = asset.payload.data.asset._id;
  const tenant = await Tenant.findOne({ slug: 'maint-test' });
  const technician = await User.create({
    tenantId: tenant._id, email: 'tech@example.com', passwordHash: 'test-only-hash',
    firstName: 'Taylor', lastName: 'Technician', role: 'technician',
    facilityIds: [facilityId], status: 'active'
  });
  technicianId = technician._id.toString();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('manager creates a work order and assigned technician can progress it', async () => {
  const created = await request('/api/v1/maintenance/work-orders', { method: 'POST', body: {
    facilityId, assetId, title: 'Inspect cooling pump vibration', type: 'corrective',
    priority: 'high', assignedTo: technicianId, dueAt: new Date(Date.now() + 86400000).toISOString(),
    estimatedHours: 2
  }});
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.data.workOrder.status, 'assigned');
  assert.match(created.payload.data.workOrder.workOrderNumber, /^WO-/);
  const { signAccessToken } = await import('../src/auth/token.service.ts');
  const tenant = await Tenant.findOne({ slug: 'maint-test' });
  const techToken = signAccessToken({ sub: technicianId, tenantId: tenant._id.toString(), role: 'technician', facilityIds: [facilityId] });
  const listing = await request('/api/v1/maintenance/work-orders', { token: techToken });
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.data.workOrders.length, 1);
  const updated = await request(`/api/v1/maintenance/work-orders/${created.payload.data.workOrder._id}`, {
    method: 'PATCH', token: techToken, body: { status: 'in_progress' }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.data.workOrder.status, 'in_progress');
  const forbidden = await request(`/api/v1/maintenance/work-orders/${created.payload.data.workOrder._id}`, {
    method: 'PATCH', token: techToken, body: { priority: 'emergency' }
  });
  assert.equal(forbidden.response.status, 403);
});

test('preventive plan generates a due work order and advances its recurrence', async () => {
  const due = new Date(Date.now() - 60_000);
  const created = await request('/api/v1/maintenance/maintenance-plans', { method: 'POST', body: {
    facilityId, assetId, planCode: 'PM-PUMP-01', title: 'Monthly pump inspection',
    frequency: 'monthly', interval: 1, nextDueAt: due.toISOString(), priority: 'medium',
    estimatedHours: 1.5
  }});
  assert.equal(created.response.status, 201);
  const generated = await request(`/api/v1/maintenance/maintenance-plans/${created.payload.data.plan._id}/generate`, { method: 'POST', body: {} });
  assert.equal(generated.response.status, 201);
  assert.equal(generated.payload.data.workOrder.type, 'preventive');
  assert.ok(new Date(generated.payload.data.nextDueAt) > due);
  const duplicate = await request(`/api/v1/maintenance/maintenance-plans/${created.payload.data.plan._id}/generate`, { method: 'POST', body: {} });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, 'PLAN_NOT_DUE');
});

test('work orders cannot be created against an asset in a different facility', async () => {
  const other = await request('/api/v1/operations/facilities', { method: 'POST', body: {
    code: 'PLANT-02', name: 'Second Plant', facilityType: 'manufacturing'
  }});
  assert.equal(other.response.status, 201);
  const invalid = await request('/api/v1/maintenance/work-orders', { method: 'POST', body: {
    facilityId: other.payload.data.facility._id, assetId, title: 'Wrong facility assignment', type: 'inspection'
  }});
  assert.equal(invalid.response.status, 404);
  assert.equal(invalid.payload.error.code, 'ASSET_NOT_FOUND');
});
