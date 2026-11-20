import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-mfa-unit-test-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL='15m';
process.env.AUTH_REFRESH_TOKEN_DAYS='14';
process.env.MFA_ENCRYPTION_KEY='forgeops-independent-mfa-encryption-key-for-tests';
const mfa=await import('../src/auth/mfa.service.ts');

test('TOTP follows RFC 6238 SHA-1 six-digit test vector',()=>{
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(mfa.generateTotpCode(secret,59_000),'287082');
  assert.equal(mfa.verifyTotp(secret,'287082',59_000),1);
  assert.equal(mfa.verifyTotp(secret,'287082',59_000,1),null);
});
test('authenticator secrets are encrypted with authenticated AES-GCM and round-trip',()=>{
  const secret=mfa.createTotpSecret();
  const encrypted=mfa.encryptSecret(secret);
  assert.notEqual(encrypted,secret);
  assert.equal(mfa.decryptSecret(encrypted),secret);
  const parts=encrypted.split('.');
  parts[2]=(parts[2].startsWith('A')?'B':'A')+parts[2].slice(1);
  assert.throws(()=>mfa.decryptSecret(parts.join('.')));
});
test('recovery codes are random, normalized and stored as one-way hashes',()=>{
  const codes=mfa.createRecoveryCodes();
  assert.equal(codes.length,10);
  assert.equal(new Set(codes).size,10);
  assert.ok(codes.every(code=>/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)));
  const hashes=codes.map(mfa.hashRecoveryCode);
  assert.equal(mfa.recoveryCodeMatches(hashes,codes[0]),hashes[0]);
  assert.equal(mfa.recoveryCodeMatches(hashes,codes[0].toLowerCase()),hashes[0]);
  assert.equal(mfa.recoveryCodeMatches(hashes,'NOT-A-VALID-CODE'),null);
});
test('TOTP enrollment secret and provisioning URI use the account issuer',()=>{
  const secret=mfa.createTotpSecret();
  const uri=mfa.otpAuthUri(secret,'operator@example.test');
  assert.match(uri,/^otpauth:\/\/totp\/ForgeOps%3Aoperator%40example\.test/);
  assert.match(uri,/algorithm=SHA1&digits=6&period=30/);
});
