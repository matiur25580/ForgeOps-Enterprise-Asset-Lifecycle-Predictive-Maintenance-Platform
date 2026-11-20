import test from 'node:test';
import assert from 'node:assert/strict';

// The token service validates configuration at import time.
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_TOKEN_SECRET = 'forgeops-test-secret-only-never-use-in-production-2026';
process.env.AUTH_ACCESS_TOKEN_TTL = '15m';
process.env.AUTH_REFRESH_TOKEN_DAYS = '14';

const tokens = await import('../src/auth/token.service.ts');
const { authorize } = await import('../src/middleware/authorize.ts');

const claims = {
  sub: 'user-123',
  tenantId: 'tenant-456',
  role: 'admin',
  facilityIds: ['facility-a', 'facility-b']
};

test('refresh tokens are cryptographically random and URL-safe', () => {
  const first = tokens.createRefreshToken();
  const second = tokens.createRefreshToken();

  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.length >= 60);
  assert.notEqual(first, second);
});

test('refresh token hashes are stable SHA-256 digests, not raw tokens', () => {
  const raw = 'sample-refresh-token';
  const digest = tokens.hashToken(raw);

  assert.equal(digest, tokens.hashToken(raw));
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, raw);
});

test('access token round-trips the tenant and authorization claims', () => {
  const encoded = tokens.signAccessToken(claims);
  const decoded = tokens.verifyAccessToken(encoded);

  assert.equal(decoded.sub, claims.sub);
  assert.equal(decoded.tenantId, claims.tenantId);
  assert.equal(decoded.role, claims.role);
  assert.deepEqual(decoded.facilityIds, claims.facilityIds);
});

test('access token verification rejects a modified signature', () => {
  const encoded = tokens.signAccessToken(claims);
  const tampered = encoded.slice(0, -1) + (encoded.endsWith('a') ? 'b' : 'a');

  assert.throws(() => tokens.verifyAccessToken(tampered));
});

test('access token verification rejects malformed token input', () => {
  assert.throws(() => tokens.verifyAccessToken('not.a.valid-token'));
});

test('authorization middleware rejects requests without authenticated claims', () => {
  let statusCode;
  let payload;
  let nextCalled = false;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; }
  };

  authorize('owner', 'admin')({ auth: undefined }, response, () => { nextCalled = true; });

  assert.equal(statusCode, 401);
  assert.equal(payload.error.code, 'UNAUTHENTICATED');
  assert.equal(nextCalled, false);
});

test('authorization middleware denies roles outside the allow-list', () => {
  let statusCode;
  let payload;
  let nextCalled = false;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; }
  };

  authorize('owner', 'admin')({ auth: { role: 'viewer' } }, response, () => { nextCalled = true; });

  assert.equal(statusCode, 403);
  assert.equal(payload.error.code, 'FORBIDDEN');
  assert.equal(nextCalled, false);
});

test('authorization middleware passes an allowed role to the next handler', () => {
  let nextCalled = false;
  const response = {
    status() { return this; },
    json() { return this; }
  };

  authorize('owner', 'admin')({ auth: { role: 'admin' } }, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
