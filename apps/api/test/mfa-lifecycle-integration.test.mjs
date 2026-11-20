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

  const setup=await call('/api/v1/mfa/setup','POST',{});
  assert.equal(setup.status,200);
  const secret=setup.data.data.secret;
  const confirmation=await call('/api/v1/mfa/confirm','POST',{
    code:service.generateTotpCode(secret)
  });
  assert.equal(confirmation.status,200);
  assert.equal(confirmation.data.data.recoveryCodes.length,10);

  const initialStatus=await call('/api/v1/mfa/status');
  assert.equal(initialStatus.status,200);
  assert.equal(initialStatus.data.data.enabled,true);
  assert.equal(initialStatus.data.data.recoveryCodesRemaining,10);

  const login=await call('/api/v1/auth/login','POST',{
    organizationSlug:account.organizationSlug,
    email:account.email,
    password:account.password
  },null);
  assert.equal(login.status,200);
  assert.equal(login.data.data.mfaRequired,true);

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
  const rotation=await call('/api/v1/mfa/recovery-codes/regenerate','POST',{code:oldCodes[0]});
  assert.equal(rotation.status,200);
  assert.equal(rotation.data.data.recoveryCodes.length,10);

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
  const rotatedCode=rotation.data.data.recoveryCodes[0];
  const rotatedCodeLoginResult=await call('/api/v1/auth/login/mfa','POST',{
    challengeToken:rotatedCodeLogin.data.data.challengeToken,
    code:rotatedCode
  },null);
  assert.equal(rotatedCodeLoginResult.status,200);
  token=rotatedCodeLoginResult.data.data.accessToken;

  const disable=await call('/api/v1/mfa/disable','POST',{
    password:account.password,
    code:rotation.data.data.recoveryCodes[1]
  });
  assert.equal(disable.status,200);
  assert.equal(disable.data.data.enabled,false);

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
  assert.equal(passwordOnlyLogin.data.data.mfaRequired,false);
  assert.ok(passwordOnlyLogin.data.data.accessToken);
});
