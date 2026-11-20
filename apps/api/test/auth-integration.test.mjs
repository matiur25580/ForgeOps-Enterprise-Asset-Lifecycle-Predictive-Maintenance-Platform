import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Start an isolated MongoDB instance before importing the app because its
// environment module validates configuration during module initialization.
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_TOKEN_SECRET = 'forgeops-integration-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL = '15m';
process.env.AUTH_REFRESH_TOKEN_DAYS = '14';

let mongod;
let mongoose;
let Tenant;
let User;
let RefreshSession;
let server;
let baseUrl;

const registration = (overrides = {}) => ({
  organizationName: 'Northstar Manufacturing',
  organizationSlug: 'northstar',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'A-Strong-Password-2026!',
  ...overrides
});

function refreshCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'response should set a refresh cookie');
  const match = setCookie.match(/forgeops_refresh=([^;]+)/);
  assert.ok(match, 'refresh cookie should be present');
  return `forgeops_refresh=${match[1]}`;
}

async function post(path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

before(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('forgeops-integration');

  const [mongooseModule, appModule, tenantModule, userModule, sessionModule] = await Promise.all([
    import('mongoose'),
    import('../src/app.ts'),
    import('../src/models/tenant.model.ts'),
    import('../src/models/user.model.ts'),
    import('../src/models/refresh-session.model.ts')
  ]);

  mongoose = mongooseModule.default;
  Tenant = tenantModule.Tenant;
  User = userModule.User;
  RefreshSession = sessionModule.RefreshSession;

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Tenant.init(), User.init(), RefreshSession.init()]);

  server = appModule.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    RefreshSession.deleteMany({})
  ]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('organization registration persists an owner and issues a secure-by-default session cookie', async () => {
  const response = await post('/api/v1/auth/register', registration());
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.data.user.role, 'owner');
  assert.equal(payload.data.user.email, 'ada@example.com');
  assert.ok(payload.data.accessToken);
  assert.equal(Object.hasOwn(payload.data.user, 'passwordHash'), false);

  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.match(cookieHeader, /Path=\/api\/v1\/auth/i);

  const tenant = await Tenant.findOne({ slug: 'northstar' });
  const user = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
  const session = await RefreshSession.findOne({ tenantId: tenant._id }).select('+tokenHash');

  assert.ok(tenant);
  assert.ok(user);
  assert.ok(user.passwordHash.startsWith('$2'));
  assert.ok(session);
  assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(session.tokenHash, refreshCookie(response).split('=')[1]);
});

test('login is scoped to the selected organization and /me returns the authenticated user', async () => {
  const alpha = await post('/api/v1/auth/register', registration());
  const alphaPayload = await alpha.json();
  await post('/api/v1/auth/register', registration({
    organizationName: 'Contoso Energy',
    organizationSlug: 'contoso',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com'
  }));

  const wrongTenant = await post('/api/v1/auth/login', {
    organizationSlug: 'northstar',
    email: 'grace@example.com',
    password: 'A-Strong-Password-2026!'
  });
  assert.equal(wrongTenant.status, 401);

  const login = await post('/api/v1/auth/login', {
    organizationSlug: 'northstar',
    email: 'ada@example.com',
    password: 'A-Strong-Password-2026!'
  });
  assert.equal(login.status, 200);

  const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${alphaPayload.data.accessToken}` }
  });
  const mePayload = await me.json();
  assert.equal(me.status, 200);
  assert.equal(mePayload.data.user.email, 'ada@example.com');
  assert.equal(mePayload.data.user.tenantId, alphaPayload.data.user.tenantId);
});

test('refresh rotation invalidates the old token and replay revokes the token family', async () => {
  const registered = await post('/api/v1/auth/register', registration());
  const originalCookie = refreshCookie(registered);

  const rotated = await post('/api/v1/auth/refresh', {}, originalCookie);
  assert.equal(rotated.status, 200);
  const replacementCookie = refreshCookie(rotated);
  assert.notEqual(replacementCookie, originalCookie);

  const replay = await post('/api/v1/auth/refresh', {}, originalCookie);
  assert.equal(replay.status, 401);

  const afterReplay = await post('/api/v1/auth/refresh', {}, replacementCookie);
  assert.equal(afterReplay.status, 401);

  const session = await RefreshSession.findOne({}).select('+usedTokenHashes');
  assert.ok(session.revokedAt);
  assert.equal(session.usedTokenHashes.length, 1);
});

test('logout revokes the refresh session and clears the cookie', async () => {
  const registered = await post('/api/v1/auth/register', registration());
  const cookie = refreshCookie(registered);

  const logout = await post('/api/v1/auth/logout', {}, cookie);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);

  const refresh = await post('/api/v1/auth/refresh', {}, cookie);
  assert.equal(refresh.status, 401);

  const session = await RefreshSession.findOne({});
  assert.ok(session.revokedAt);
});
