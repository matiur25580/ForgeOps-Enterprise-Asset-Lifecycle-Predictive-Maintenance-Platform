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
  await User.updateOne({email:account.email},{$set:{status:'active'}});

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
