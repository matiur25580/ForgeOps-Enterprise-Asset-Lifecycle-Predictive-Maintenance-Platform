import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encryptionKey():Buffer{return createHash('sha256').update('forgeops:mfa:encryption:v1:').update(env.mfaEncryptionKey).digest();}
export function encryptSecret(secret:string):string{
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptSecret(value:string):string{
  const [iv,tag,data]=value.split('.');
  if(!iv||!tag||!data)throw new Error('Invalid encrypted MFA secret');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
}
export function createTotpSecret():string{
  let output='',buffer=0,bits=0;
  for(const byte of randomBytes(20)){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5){output+=alphabet[(buffer>>(bits-5))&31];bits-=5;}}
  if(bits)output+=alphabet[(buffer<<(5-bits))&31];
  return output;
}
function decodeBase32(value:string):Buffer{
  let buffer=0,bits=0;const bytes:number[]=[];
  for(const char of value.toUpperCase().replace(/=+$/,'')){const index=alphabet.indexOf(char);if(index<0)throw new Error('Invalid Base32 secret');buffer=(buffer<<5)|index;bits+=5;if(bits>=8){bytes.push((buffer>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
export function generateTotpCode(secret:string,now=Date.now()):string{
  const step=Math.floor(now/30_000);
  return codeFor(secret,step);
}
function codeFor(secret:string,step:number):string{
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const digest=createHmac('sha1',decodeBase32(secret)).update(counter).digest();
  const offset=digest[digest.length-1]!&15;
  const binary=((digest[offset]!&127)<<24)|((digest[offset+1]!&255)<<16)|((digest[offset+2]!&255)<<8)|(digest[offset+3]!&255);
  return String(binary%1_000_000).padStart(6,'0');
}
export function verifyTotp(secret:string,code:string,now=Date.now(),lastUsedStep=-1):number|null{
  if(!/^\d{6}$/.test(code))return null;
  const current=Math.floor(now/30_000);
  for(const step of [current-1,current,current+1]){
    if(step<=lastUsedStep)continue;
    const expected=Buffer.from(codeFor(secret,step));
    const actual=Buffer.from(code);
    if(expected.length===actual.length&&timingSafeEqual(expected,actual))return step;
  }
  return null;
}
export function createRecoveryCodes():string[]{
  return Array.from({length:10},()=>{const raw=randomBytes(6).toString('hex').toUpperCase();return raw.match(/.{1,4}/g)!.join('-');});
}
export function hashRecoveryCode(code:string):string{return createHash('sha256').update(code.replace(/-/g,'').toUpperCase()).digest('hex');}
export function recoveryCodeMatches(stored:string[],code:string):string|null{
  const candidate=hashRecoveryCode(code);
  return stored.find(hash=>{const a=Buffer.from(hash);const b=Buffer.from(candidate);return a.length===b.length&&timingSafeEqual(a,b);})??null;
}
export function otpAuthUri(secret:string,email:string,issuer='ForgeOps'):string{
  const label=encodeURIComponent(issuer+':'+email);
  return 'otpauth://totp/'+label+'?secret='+secret+'&issuer='+encodeURIComponent(issuer)+'&algorithm=SHA1&digits=6&period=30';
}

export async function consumeMfaProof(userId:string,tenantId:string,code:string):Promise<boolean>{
  const user=await User.findOne({_id:userId,tenantId,status:'active',mfaEnabled:true})
    .select('+mfaSecretEncrypted +mfaRecoveryCodeHashes +mfaLastUsedStep');
  if(!user)return false;
  const recoveryHash=recoveryCodeMatches(user.mfaRecoveryCodeHashes,code);
  if(recoveryHash){
    const result=await User.updateOne({_id:user._id,tenantId,mfaEnabled:true,mfaRecoveryCodeHashes:recoveryHash},{$pull:{mfaRecoveryCodeHashes:recoveryHash}});
    return result.modifiedCount===1;
  }
  if(!user.mfaSecretEncrypted)return false;
  const step=verifyTotp(decryptSecret(user.mfaSecretEncrypted),code,Date.now(),user.mfaLastUsedStep??-1);
  if(step===null)return false;
  const result=await User.updateOne({_id:user._id,tenantId,mfaEnabled:true,mfaLastUsedStep:{$lt:step}},{$set:{mfaLastUsedStep:step}});
  return result.modifiedCount===1;
}
