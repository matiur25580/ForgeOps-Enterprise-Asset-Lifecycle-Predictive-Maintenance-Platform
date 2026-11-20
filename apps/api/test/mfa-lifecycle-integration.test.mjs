import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_TOKEN_SECRET='forgeops-mfa-lifecycle-test-secret-never-use-production';
process.env.AUTH_ACCESS_TOKEN_TTL='15m';
process.env.AUTH_REFRESH_TOKEN_DAYS='14';
process.env.MFA_ENCRYPTION_KEY='forgeops-independent-mfa-lifecycle-key-for-tests';

let db,server,url,token;
const account={
  organizationName:'Lifecycle Security Factory',
  organizationSlug:'lifecycle-security-factory',
  firstName:'Taylor',
  lastName:'Admin',
  email:'taylor@lifecycle-factory.test',
  password:'A-Strong-Lifecycle-Password-2026!'
};

async function call(path,method='GET',body,auth=token){
  const response=await fetch(url+path,{
    method,
    headers:{
      ...(auth?{authorization:'Bearer '+auth}:{}),
      ...(body?{'content-type':'application/json'}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  return {status:response.status,data:await response.json().catch(()=>null)};
}

before(async()=>{
  const {MongoMemoryServer}=await import('mongodb-memory-server');
  const mongo=await MongoMemoryServer.create();
  process.env.MONGODB_URI=mongo.getUri('mfa-lifecycle');
  const mongoose=(await import('mongoose')).default;
  db=mongoose;
  const {app}=await import('../src/app.ts');
  await db.connect(process.env.MONGODB_URI);
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  url='http://127.0.0.1:'+server.address().port;
  server.mongo=mongo;
});

after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)await db.disconnect();
  if(server?.mongo)await server.mongo.stop();
});

test('MFA lifecycle enforces setup expiry, TOTP replay protection, recovery rotation and secure disablement',async()=>{
  const service=await import('../src/auth/mfa.service.ts');
  const created=await call('/api/v1/auth/register','POST',account,null);
  assert.equal(created.status,201);
  token=created.data.data.accessToken;

  const firstSetup=await call('/api/v1/mfa/setup','POST',{});
  assert.equal(firstSetup.status,200);
  const {User}=await import('../src/models/user.model.ts');
  await User.updateOne(
    {email:account.email},
    {$set:{mfaPendingSecretExpiresAt:new Date(Date.now()-1_000)}}
  );
  const expiredConfirmation=await call('/api/v1/mfa/confirm','POST',{
    code:service.generateTotpCode(firstSetup.data.data.secret)
  });
  assert.equal(expiredConfirmation.status,409);
  assert.equal(expiredConfirmation.data.error.code,'MFA_SETUP_NOT_STARTED');

  const setupBeforeRotation=await call('/api/v1/mfa/setup','POST',{});
  assert.equal(setupBeforeRotation.status,200);
  const setup=await call('/api/v1/mfa/setup','POST',{});
  assert.equal(setup.status,200);
  const secret=setup.data.data.secret;
  const supersededConfirmation=await call('/api/v1/mfa/confirm','POST',{
    code:service.generateTotpCode(setupBeforeRotation.data.data.secret)
  });
  assert.equal(supersededConfirmation.status,400);
  assert.equal(supersededConfirmation.data.error.code,'MFA_CODE_INVALID');
  const rejectedConfirmation=await call('/api/v1/mfa/confirm','POST',{code:'abcdef'});
  assert.equal(rejectedConfirmation.status,400);
  assert.equal(rejectedConfirmation.data.error.code,'MFA_CODE_INVALID');
  const statusAfterRejectedConfirmation=await call('/api/v1/mfa/status');
  assert.equal(statusAfterRejectedConfirmation.status,200);
  assert.equal(statusAfterRejectedConfirmation.data.data.enabled,false);

  const confirmationAttempts=await Promise.all([0,1].map(()=>call('/api/v1/mfa/confirm','POST',{
    code:service.generateTotpCode(secret)
  })));
  assert.deepEqual(confirmationAttempts.map(result=>result.status).sort(),[200,409]);
  const confirmation=confirmationAttempts.find(result=>result.status===200);
  assert.ok(confirmation);
  assert.equal(confirmation.data.data.recoveryCodes.length,10);

  const initialStatus=await call('/api/v1/mfa/status');
  assert.equal(initialStatus.status,200);
  assert.equal(initialStatus.data.data.enabled,true);
  assert.equal(initialStatus.data.data.recoveryCodesRemaining,10);

  const duplicateSetup=await call('/api/v1/mfa/setup','POST',{});
  assert.equal(duplicateSetup.status,409);
  assert.equal(duplicateSetup.data.error.code,'MFA_ALREADY_ENABLED');
  const statusAfterDuplicateSetup=await call('/api/v1/mfa/status');
  assert.equal(statusAfterDuplicateSetup.data.data.enabled,true);
  assert.equal(statusAfterDuplicateSetup.data.data.recoveryCodesRemaining,10);

  const login=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  assert.equal(login.status,200);
  assert.equal(login.data.data.mfaRequired,true);

  const jwt=(await import('jsonwebtoken')).default;
  const challengeClaims=jwt.decode(login.data.data.challengeToken);
  const tamperedChallengeParts=login.data.data.challengeToken.split('.');
  tamperedChallengeParts[2]=(tamperedChallengeParts[2][0]==='a'?'b':'a')+tamperedChallengeParts[2].slice(1);
  const tamperedChallengeAttempt=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:tamperedChallengeParts.join('.'),
    code:service.generateTotpCode(secret)
  },null);
  assert.equal(tamperedChallengeAttempt.status,401);
  assert.equal(tamperedChallengeAttempt.data.error.code,'MFA_CHALLENGE_INVALID_OR_EXPIRED');

  const wrongPurposeChallenge=jwt.sign(
    {sub:challengeClaims.sub,tenantId:challengeClaims.tenantId,purpose:'access'},
    process.env.AUTH_ACCESS_TOKEN_SECRET,
    {algorithm:'HS256',expiresIn:'5m'}
  );
  const wrongPurposeAttempt=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:wrongPurposeChallenge,
    code:service.generateTotpCode(secret)
  },null);
  assert.equal(wrongPurposeAttempt.status,401);
  assert.equal(wrongPurposeAttempt.data.error.code,'MFA_CHALLENGE_INVALID_OR_EXPIRED');

  const expiredChallenge=jwt.sign(
    {...challengeClaims,exp:Math.floor(Date.now()/1000)-1},
    process.env.AUTH_ACCESS_TOKEN_SECRET,
    {algorithm:'HS256'}
  );
  const expiredChallengeAttempt=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:expiredChallenge,
    code:service.generateTotpCode(secret)
  },null);
  assert.equal(expiredChallengeAttempt.status,401);
  assert.equal(expiredChallengeAttempt.data.error.code,'MFA_CHALLENGE_INVALID_OR_EXPIRED');

  const otp=service.generateTotpCode(secret,Date.now()+30_000);
  const verified=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:login.data.data.challengeToken,
    code:otp
  },null);
  assert.equal(verified.status,200);
  assert.ok(verified.data.data.accessToken);

  const replayLogin=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  assert.equal(replayLogin.status,200);
  const replay=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:replayLogin.data.data.challengeToken,
    code:otp
  },null);
  assert.equal(replay.status,401);

  token=verified.data.data.accessToken;
  const oldCodes=confirmation.data.data.recoveryCodes;

  const concurrentLogins=await Promise.all([0,1].map(()=>call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null)));
  assert.ok(concurrentLogins.every(result=>result.status===200));
  const concurrentProofs=await Promise.all(concurrentLogins.map(result=>call('/api/v1/auth/login/mfa','POST',{
    challengeToken:result.data.data.challengeToken,
    code:oldCodes[0]
  },null)));
  assert.deepEqual(concurrentProofs.map(result=>result.status).sort(),[200,401]);
  const statusAfterConcurrentUse=await call('/api/v1/mfa/status');
  assert.equal(statusAfterConcurrentUse.status,200);
  assert.equal(statusAfterConcurrentUse.data.data.recoveryCodesRemaining,9);

  const rejectedRotation=await call('/api/v1/mfa/recovery-codes/regenerate','POST',{code:'000000'});
  assert.equal(rejectedRotation.status,401);
  assert.equal(rejectedRotation.data.error.code,'MFA_CODE_INVALID_OR_ALREADY_USED');
  const statusAfterRejectedRotation=await call('/api/v1/mfa/status');
  assert.equal(statusAfterRejectedRotation.data.data.recoveryCodesRemaining,9);

  const rotation=await call('/api/v1/mfa/recovery-codes/regenerate','POST',{code:oldCodes[2]});
  assert.equal(rotation.status,200);
  assert.equal(rotation.data.data.recoveryCodes.length,10);

  const concurrentRotations=await Promise.all([0,1].map(()=>call('/api/v1/mfa/recovery-codes/regenerate','POST',{
    code:rotation.data.data.recoveryCodes[2]
  })));
  assert.deepEqual(concurrentRotations.map(result=>result.status).sort(),[200,401]);
  const concurrentRotation=concurrentRotations.find(result=>result.status===200);
  assert.ok(concurrentRotation);
  assert.equal(concurrentRotation.data.data.recoveryCodes.length,10);
  const statusAfterConcurrentRotation=await call('/api/v1/mfa/status');
  assert.equal(statusAfterConcurrentRotation.status,200);
  assert.equal(statusAfterConcurrentRotation.data.data.recoveryCodesRemaining,10);

  const oldCodeLogin=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  const invalidatedCode=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:oldCodeLogin.data.data.challengeToken,
    code:oldCodes[1]
  },null);
  assert.equal(invalidatedCode.status,401);

  const rotatedCodeLogin=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  const rotatedCode=concurrentRotation.data.data.recoveryCodes[0];
  const rotatedCodeLoginResult=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:rotatedCodeLogin.data.data.challengeToken,
    code:rotatedCode
  },null);
  assert.equal(rotatedCodeLoginResult.status,200);
  token=rotatedCodeLoginResult.data.data.accessToken;

  const wrongPasswordDisable=await call('/api/v1/mfa/disable','POST',{
    password:'Definitely-Wrong-Password-2026!',
    code:concurrentRotation.data.data.recoveryCodes[1]
  });
  assert.equal(wrongPasswordDisable.status,401);
  assert.equal(wrongPasswordDisable.data.error.code,'PASSWORD_INVALID');

  const invalidProofDisable=await call('/api/v1/mfa/disable','POST',{
    password:account.password,
    code:'000000'
  });
  assert.equal(invalidProofDisable.status,401);
  assert.equal(invalidProofDisable.data.error.code,'MFA_CODE_INVALID_OR_ALREADY_USED');

  const stillEnabled=await call('/api/v1/mfa/status');
  assert.equal(stillEnabled.status,200);
  assert.equal(stillEnabled.data.data.enabled,true);

  const inactiveAccountLogin=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  assert.equal(inactiveAccountLogin.status,200);
  assert.equal(inactiveAccountLogin.data.data.mfaRequired,true);

  await User.updateOne({email:account.email},{$set:{status:'disabled'}});
  const inactiveUser=await User.findOne({email:account.email});
  assert.ok(inactiveUser);
  const inactiveAccountProof=await service.consumeMfaProof(
    inactiveUser._id.toString(),
    inactiveUser.tenantId.toString(),
    concurrentRotation.data.data.recoveryCodes[4]
  );
  assert.equal(inactiveAccountProof,false);

  const inactiveAccountMfaLogin=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:inactiveAccountLogin.data.data.challengeToken,
    code:concurrentRotation.data.data.recoveryCodes[5]
  },null);
  assert.equal(inactiveAccountMfaLogin.status,401);
  assert.equal(inactiveAccountMfaLogin.data.error.code,'MFA_CODE_INVALID_OR_ALREADY_USED');

  const {RefreshSession}=await import('../src/models/refresh-session.model.ts');
  const {hashToken,refreshExpiry}=await import('../src/auth/token.service.ts');
  const disabledRefreshToken='disabled-account-refresh-token-for-regression-test';
  const refreshFamilyId='disabled-account-refresh-family';
  const disabledSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(disabledRefreshToken),
    familyId:refreshFamilyId,
    expiresAt:refreshExpiry()
  });
  const disabledRefreshResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+disabledRefreshToken}
  });
  const disabledRefreshBody=await disabledRefreshResponse.json();
  assert.equal(disabledRefreshResponse.status,401);
  assert.equal(disabledRefreshBody.error.code,'ACCOUNT_UNAVAILABLE');
  const revokedDisabledSession=await RefreshSession.findById(disabledSession._id);
  assert.ok(revokedDisabledSession.revokedAt);

  await User.updateOne({email:account.email},{$set:{status:'active'}});

  const reusedRefreshToken='refresh-token-reuse-regression-test-token';
  const reuseSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(reusedRefreshToken),
    familyId:'refresh-token-reuse-family',
    expiresAt:refreshExpiry()
  });
  const firstRefresh=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+reusedRefreshToken}
  });
  assert.equal(firstRefresh.status,200);
  const rotatedCookie=firstRefresh.headers.get('set-cookie')??'';
  const rotatedRefreshToken=rotatedCookie.match(/forgeops_refresh=([^;]+)/)?.[1];
  assert.match(rotatedCookie,/forgeops_refresh=[^;]+/);
  assert.match(rotatedCookie,/Path=\/api\/v1\/auth/i);
  assert.match(rotatedCookie,/HttpOnly/i);
  assert.match(rotatedCookie,/SameSite=Lax/i);
  assert.match(rotatedCookie,/Max-Age=\d+/i);
  assert.ok(rotatedRefreshToken);
  assert.notEqual(rotatedRefreshToken,reusedRefreshToken);
  const rotatedSession=await RefreshSession.findById(reuseSession._id).select('+tokenHash +usedTokenHashes');
  assert.ok(rotatedSession);
  assert.equal(rotatedSession.tokenHash,hashToken(rotatedRefreshToken));
  assert.ok(rotatedSession.usedTokenHashes.includes(hashToken(reusedRefreshToken)));
  assert.ok(!rotatedSession.usedTokenHashes.includes(hashToken(rotatedRefreshToken)));
  assert.notEqual(rotatedSession.tokenHash,hashToken(reusedRefreshToken));

  const replayedRefresh=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+reusedRefreshToken}
  });
  const replayedRefreshBody=await replayedRefresh.json();
  assert.equal(replayedRefresh.status,401);
  assert.equal(replayedRefreshBody.error.code,'REFRESH_TOKEN_INVALID');
  const clearedReplayCookie=replayedRefresh.headers.get('set-cookie')??'';
  assert.match(clearedReplayCookie,/forgeops_refresh=;/);
  assert.match(clearedReplayCookie,/Max-Age=0/i);
  const revokedReuseSession=await RefreshSession.findById(reuseSession._id);
  assert.ok(revokedReuseSession.revokedAt);

  const rotatedAfterReuse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+rotatedRefreshToken}
  });
  const rotatedAfterReuseBody=await rotatedAfterReuse.json();
  assert.equal(rotatedAfterReuse.status,401);
  assert.equal(rotatedAfterReuseBody.error.code,'REFRESH_TOKEN_INVALID');

  // Replaying one family's retired token must never revoke an independent family.
  const isolatedFamilyAToken='independent-refresh-family-a-token';
  const isolatedFamilyBToken='independent-refresh-family-b-token';
  const [isolatedFamilyA,isolatedFamilyB]=await Promise.all([
    RefreshSession.create({
      userId:inactiveUser._id,
      tenantId:inactiveUser.tenantId,
      tokenHash:hashToken(isolatedFamilyAToken),
      familyId:'independent-refresh-family-a',
      expiresAt:refreshExpiry()
    }),
    RefreshSession.create({
      userId:inactiveUser._id,
      tenantId:inactiveUser.tenantId,
      tokenHash:hashToken(isolatedFamilyBToken),
      familyId:'independent-refresh-family-b',
      expiresAt:refreshExpiry()
    })
  ]);
  const isolatedFamilyARefresh=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+isolatedFamilyAToken}
  });
  assert.equal(isolatedFamilyARefresh.status,200);
  const isolatedFamilyANewToken=(isolatedFamilyARefresh.headers.get('set-cookie')??'').match(/forgeops_refresh=([^;]+)/)?.[1];
  assert.ok(isolatedFamilyANewToken);
  const isolatedFamilyAReplay=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+isolatedFamilyAToken}
  });
  assert.equal(isolatedFamilyAReplay.status,401);
  const isolatedFamilyAAfterReplay=await RefreshSession.findById(isolatedFamilyA._id);
  const isolatedFamilyBAfterReplay=await RefreshSession.findById(isolatedFamilyB._id).select('+tokenHash');
  assert.ok(isolatedFamilyAAfterReplay.revokedAt);
  assert.equal(isolatedFamilyBAfterReplay.revokedAt,null);
  assert.equal(isolatedFamilyBAfterReplay.tokenHash,hashToken(isolatedFamilyBToken));
  const isolatedFamilyBRefresh=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+isolatedFamilyBToken}
  });
  assert.equal(isolatedFamilyBRefresh.status,200);
  const isolatedFamilyBRotated=await RefreshSession.findById(isolatedFamilyB._id).select('+tokenHash');
  assert.equal(isolatedFamilyBRotated.revokedAt,null);
  assert.notEqual(isolatedFamilyBRotated.tokenHash,hashToken(isolatedFamilyBToken));

  // A session whose tenant does not own its user must not mint an access token.
  const {Tenant}=await import('../src/models/tenant.model.ts');
  const foreignTenant=await Tenant.create({
    name:'Refresh Isolation Foreign Tenant',
    slug:'refresh-isolation-foreign-tenant'
  });
  const mismatchedTenantToken='refresh-session-cross-tenant-mismatch-token';
  const mismatchedTenantSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:foreignTenant._id,
    tokenHash:hashToken(mismatchedTenantToken),
    familyId:'refresh-session-cross-tenant-mismatch-family',
    expiresAt:refreshExpiry()
  });
  const mismatchedTenantRefresh=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+mismatchedTenantToken}
  });
  const mismatchedTenantBody=await mismatchedTenantRefresh.json();
  assert.equal(mismatchedTenantRefresh.status,401);
  assert.equal(mismatchedTenantBody.error.code,'ACCOUNT_UNAVAILABLE');
  assert.equal(mismatchedTenantBody.data,undefined);
  assert.match(mismatchedTenantRefresh.headers.get('set-cookie')??'',/Max-Age=0/i);
  const revokedMismatchedTenantSession=await RefreshSession.findById(mismatchedTenantSession._id);
  assert.ok(revokedMismatchedTenantSession.revokedAt);

  const concurrentRefreshToken='concurrent-refresh-race-regression-token';
  const concurrentRefreshSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(concurrentRefreshToken),
    familyId:'concurrent-refresh-race-family',
    expiresAt:refreshExpiry()
  });
  const concurrentRefreshes=await Promise.all([0,1].map(()=>fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+concurrentRefreshToken}
  })));
  assert.deepEqual(concurrentRefreshes.map(result=>result.status).sort(),[200,401]);
  const successfulRefresh=concurrentRefreshes.find(result=>result.status===200);
  const rejectedRefresh=concurrentRefreshes.find(result=>result.status===401);
  assert.ok(successfulRefresh);
  assert.ok(rejectedRefresh);
  const successfulRefreshCookie=successfulRefresh.headers.get('set-cookie')??'';
  const successfulRefreshToken=successfulRefreshCookie.match(/forgeops_refresh=([^;]+)/)?.[1];
  assert.ok(successfulRefreshToken);
  const concurrentRefreshBody=await rejectedRefresh.json();
  assert.equal(concurrentRefreshBody.error.code,'REFRESH_TOKEN_INVALID');
  const revokedConcurrentRefreshSession=await RefreshSession.findById(concurrentRefreshSession._id);
  assert.ok(revokedConcurrentRefreshSession.revokedAt);
  const refreshAfterConcurrentReuse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+successfulRefreshToken}
  });
  assert.equal(refreshAfterConcurrentReuse.status,401);
  const refreshAfterConcurrentReuseBody=await refreshAfterConcurrentReuse.json();
  assert.equal(refreshAfterConcurrentReuseBody.error.code,'REFRESH_TOKEN_INVALID');

  const logoutRefreshToken='logout-refresh-revocation-regression-token';
  const logoutSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(logoutRefreshToken),
    familyId:'logout-refresh-revocation-family',
    expiresAt:refreshExpiry()
  });
  const logoutResponse=await fetch(url+'/api/v1/auth/logout',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+logoutRefreshToken}
  });
  assert.equal(logoutResponse.status,204);
  const clearedLogoutCookie=logoutResponse.headers.get('set-cookie')??'';
  assert.match(clearedLogoutCookie,/forgeops_refresh=;/);
  assert.match(clearedLogoutCookie,/Path=\/api\/v1\/auth/i);
  assert.match(clearedLogoutCookie,/Max-Age=0/i);
  assert.match(clearedLogoutCookie,/HttpOnly/i);
  assert.match(clearedLogoutCookie,/SameSite=Lax/i);
  const revokedLogoutSession=await RefreshSession.findById(logoutSession._id);
  assert.ok(revokedLogoutSession.revokedAt);
  const refreshAfterLogout=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+logoutRefreshToken}
  });
  assert.equal(refreshAfterLogout.status,401);
  const refreshAfterLogoutBody=await refreshAfterLogout.json();
  assert.equal(refreshAfterLogoutBody.error.code,'REFRESH_TOKEN_INVALID');
  const repeatedLogout=await fetch(url+'/api/v1/auth/logout',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+logoutRefreshToken}
  });
  assert.equal(repeatedLogout.status,204);
  const logoutWithoutCookie=await fetch(url+'/api/v1/auth/logout',{method:'POST'});
  assert.equal(logoutWithoutCookie.status,204);
  const clearedMissingCookie=logoutWithoutCookie.headers.get('set-cookie')??'';
  assert.match(clearedMissingCookie,/forgeops_refresh=;/);
  assert.match(clearedMissingCookie,/Path=\/api\/v1\/auth/i);
  assert.match(clearedMissingCookie,/Max-Age=0/i);

  const missingRefreshCookieResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST'
  });
  assert.equal(missingRefreshCookieResponse.status,401);
  const missingRefreshCookieBody=await missingRefreshCookieResponse.json();
  assert.equal(missingRefreshCookieBody.error.code,'REFRESH_TOKEN_MISSING');

  const malformedRefreshCookieResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh=%ZZ%broken'}
  });
  assert.equal(malformedRefreshCookieResponse.status,401);
  const malformedRefreshCookieBody=await malformedRefreshCookieResponse.json();
  assert.equal(malformedRefreshCookieBody.error.code,'REFRESH_TOKEN_INVALID');

  const boundaryExpiredToken='refresh-token-expired-at-boundary-regression';
  const boundaryExpiredAt=new Date(Date.now()-1);
  const boundaryExpiredSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(boundaryExpiredToken),
    familyId:'refresh-token-expiry-boundary-family',
    expiresAt:boundaryExpiredAt
  });
  const boundaryExpiredResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+boundaryExpiredToken}
  });
  assert.equal(boundaryExpiredResponse.status,401);
  const boundaryExpiredBody=await boundaryExpiredResponse.json();
  assert.equal(boundaryExpiredBody.error.code,'REFRESH_TOKEN_INVALID');
  const unchangedBoundarySession=await RefreshSession.findById(boundaryExpiredSession._id).select('+tokenHash');
  assert.ok(unchangedBoundarySession);
  assert.equal(unchangedBoundarySession.revokedAt,null);
  assert.equal(unchangedBoundarySession.tokenHash,hashToken(boundaryExpiredToken));

  const expiredRefreshToken='expired-refresh-token-regression-test';
  const expiredRefreshSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(expiredRefreshToken),
    familyId:'expired-refresh-token-family',
    expiresAt:new Date(Date.now()-60_000)
  });
  const expiredRefreshResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+expiredRefreshToken}
  });
  assert.equal(expiredRefreshResponse.status,401);
  const expiredRefreshBody=await expiredRefreshResponse.json();
  assert.equal(expiredRefreshBody.error.code,'REFRESH_TOKEN_INVALID');
  const unchangedExpiredSession=await RefreshSession.findById(expiredRefreshSession._id).select('+tokenHash');
  assert.ok(unchangedExpiredSession);
  assert.equal(unchangedExpiredSession.revokedAt,null);
  assert.equal(unchangedExpiredSession.tokenHash,hashToken(expiredRefreshToken));

  const alreadyRevokedToken='already-revoked-refresh-token-regression-test';
  const priorRevocation=new Date(Date.now()-5_000);
  const alreadyRevokedSession=await RefreshSession.create({
    userId:inactiveUser._id,
    tenantId:inactiveUser.tenantId,
    tokenHash:hashToken(alreadyRevokedToken),
    familyId:'already-revoked-refresh-token-family',
    expiresAt:refreshExpiry(),
    revokedAt:priorRevocation
  });
  const revokedRefreshResponse=await fetch(url+'/api/v1/auth/refresh',{
    method:'POST',
    headers:{cookie:'forgeops_refresh='+alreadyRevokedToken}
  });
  assert.equal(revokedRefreshResponse.status,401);
  const revokedRefreshBody=await revokedRefreshResponse.json();
  assert.equal(revokedRefreshBody.error.code,'REFRESH_TOKEN_INVALID');
  const unchangedRevokedSession=await RefreshSession.findById(alreadyRevokedSession._id).select('+tokenHash');
  assert.ok(unchangedRevokedSession);
  assert.equal(unchangedRevokedSession.revokedAt.getTime(),priorRevocation.getTime());
  assert.equal(unchangedRevokedSession.tokenHash,hashToken(alreadyRevokedToken));

  const concurrentDisables=await Promise.all([2,3].map(index=>call('/api/v1/mfa/disable','POST',{
    password:account.password,
    code:concurrentRotation.data.data.recoveryCodes[index]
  })));
  assert.equal(concurrentDisables.filter(result=>result.status===200).length,1);
  const successfulDisable=concurrentDisables.find(result=>result.status===200);
  const rejectedDisable=concurrentDisables.find(result=>result.status!==200);
  assert.ok(successfulDisable);
  assert.ok(rejectedDisable);
  assert.ok([401,409].includes(rejectedDisable.status));
  if(rejectedDisable.status===409)assert.equal(rejectedDisable.data.error.code,'MFA_STATE_CHANGED');
  if(rejectedDisable.status===401)assert.equal(rejectedDisable.data.error.code,'MFA_CODE_INVALID_OR_ALREADY_USED');
  assert.equal(successfulDisable.data.data.enabled,false);

  const finalStatus=await call('/api/v1/mfa/status');
  assert.equal(finalStatus.status,200);
  assert.equal(finalStatus.data.data.enabled,false);
  assert.equal(finalStatus.data.data.recoveryCodesRemaining,0);

  const passwordOnlyLogin=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  assert.equal(passwordOnlyLogin.status,200);
  assert.notEqual(passwordOnlyLogin.data.data.mfaRequired,true);
  assert.ok(passwordOnlyLogin.data.data.accessToken);
});
