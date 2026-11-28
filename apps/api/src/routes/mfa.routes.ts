import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { AuditEvent } from '../models/audit-event.model.js';
import { User } from '../models/user.model.js';
import { consumeMfaProof, createRecoveryCodes, createTotpSecret, decryptSecret, encryptSecret, hashRecoveryCode, otpAuthUri, verifyTotp } from '../auth/mfa.service.js';

export const mfaRouter=Router();
mfaRouter.use(authenticate);
const mfaLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false,skip:()=>process.env.NODE_ENV==='test'});
const codeSchema=z.object({code:z.string().min(6).max(32)});
async function recordChange(tenantId:string,userId:string,enabled:boolean){
  await AuditEvent.create({tenantId:new Types.ObjectId(tenantId),actorUserId:new Types.ObjectId(userId),entityType:'team_member',entityId:new Types.ObjectId(userId),action:'updated',changes:{mfaEnabled:enabled}});
}

mfaRouter.get('/status',async(req,res,next)=>{
  try{
    const user=await User.findOne({_id:req.auth!.sub,tenantId:req.auth!.tenantId,status:'active'}).select('mfaEnabled +mfaRecoveryCodeHashes');
    if(!user){res.status(404).json({error:{code:'USER_NOT_FOUND'}});return;}
    res.status(200).json({data:{enabled:user.mfaEnabled,recoveryCodesRemaining:user.mfaRecoveryCodeHashes.length}});
  }catch(error){next(error);}
});

mfaRouter.post('/setup',mfaLimiter,async(req,res,next)=>{
  try{
    const user=await User.findOne({_id:req.auth!.sub,tenantId:req.auth!.tenantId,status:'active'});
    if(!user){res.status(404).json({error:{code:'USER_NOT_FOUND'}});return;}
    if(user.mfaEnabled){res.status(409).json({error:{code:'MFA_ALREADY_ENABLED'}});return;}
    const secret=createTotpSecret();
    user.mfaPendingSecretEncrypted=encryptSecret(secret);
    user.mfaPendingSecretExpiresAt=new Date(Date.now()+10*60*1000);
    await user.save();
    res.status(200).json({data:{secret,otpauthUri:otpAuthUri(secret,user.email),issuer:'ForgeOps',account:user.email}});
  }catch(error){next(error);}
});

mfaRouter.post('/confirm',mfaLimiter,async(req,res,next)=>{
  try{
    const parsed=codeSchema.safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR'}});return;}
    const user=await User.findOne({_id:req.auth!.sub,tenantId:req.auth!.tenantId,status:'active'}).select('+mfaPendingSecretEncrypted +mfaPendingSecretExpiresAt');
    if(!user?.mfaPendingSecretEncrypted||!user.mfaPendingSecretExpiresAt||user.mfaPendingSecretExpiresAt<=new Date()){res.status(409).json({error:{code:'MFA_SETUP_NOT_STARTED'}});return;}
    const secret=decryptSecret(user.mfaPendingSecretEncrypted);
    const step=verifyTotp(secret,parsed.data.code);
    if(step===null){res.status(400).json({error:{code:'MFA_CODE_INVALID'}});return;}
    const recoveryCodes=createRecoveryCodes();
    const activation=await User.updateOne(
      {
        _id:user._id,
        tenantId:user.tenantId,
        status:'active',
        mfaEnabled:false,
        mfaPendingSecretEncrypted:user.mfaPendingSecretEncrypted,
        mfaPendingSecretExpiresAt:{$gt:new Date()}
      },
      {
        $set:{
          mfaSecretEncrypted:user.mfaPendingSecretEncrypted,
          mfaRecoveryCodeHashes:recoveryCodes.map(hashRecoveryCode),
          mfaLastUsedStep:step,
          mfaEnabled:true
        },
        $unset:{mfaPendingSecretEncrypted:1,mfaPendingSecretExpiresAt:1}
      }
    );
    if(activation.modifiedCount!==1){res.status(409).json({error:{code:'MFA_SETUP_NOT_STARTED'}});return;}
    await recordChange(req.auth!.tenantId,req.auth!.sub,true);
    res.status(200).json({data:{enabled:true,recoveryCodes,warning:'Recovery codes are displayed once. Store them securely; each code works once.'}});
  }catch(error){next(error);}
});

mfaRouter.post('/disable',mfaLimiter,async(req,res,next)=>{
  try{
    const parsed=z.object({password:z.string().min(1).max(128),code:z.string().min(6).max(32)}).safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR'}});return;}
    const user=await User.findOne({_id:req.auth!.sub,tenantId:req.auth!.tenantId,status:'active'}).select('+passwordHash +mfaSecretEncrypted +mfaRecoveryCodeHashes +mfaLastUsedStep');
    if(!user){res.status(404).json({error:{code:'USER_NOT_FOUND'}});return;}
    if(!user.mfaEnabled||!user.mfaSecretEncrypted){res.status(409).json({error:{code:'MFA_NOT_ENABLED'}});return;}
    if(!await bcrypt.compare(parsed.data.password,user.passwordHash)){res.status(401).json({error:{code:'PASSWORD_INVALID'}});return;}
    if(!await consumeMfaProof(user._id.toString(),user.tenantId.toString(),parsed.data.code)){res.status(401).json({error:{code:'MFA_CODE_INVALID_OR_ALREADY_USED'}});return;}
    const disablement=await User.updateOne(
      {_id:user._id,tenantId:user.tenantId,status:'active',mfaEnabled:true},
      {$set:{mfaEnabled:false,mfaRecoveryCodeHashes:[],mfaLastUsedStep:-1},$unset:{mfaSecretEncrypted:1,mfaPendingSecretEncrypted:1,mfaPendingSecretExpiresAt:1}}
    );
    if(disablement.modifiedCount!==1){res.status(409).json({error:{code:'MFA_STATE_CHANGED'}});return;}
    await recordChange(req.auth!.tenantId,req.auth!.sub,false);
    res.status(200).json({data:{enabled:false}});
  }catch(error){next(error);}
});

mfaRouter.post('/recovery-codes/regenerate',mfaLimiter,async(req,res,next)=>{
  try{
    const parsed=codeSchema.safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:{code:'VALIDATION_ERROR'}});return;}
    if(!await consumeMfaProof(req.auth!.sub,req.auth!.tenantId,parsed.data.code)){res.status(401).json({error:{code:'MFA_CODE_INVALID_OR_ALREADY_USED'}});return;}
    const codes=createRecoveryCodes();
    const rotation=await User.updateOne(
      {_id:req.auth!.sub,tenantId:req.auth!.tenantId,status:'active',mfaEnabled:true},
      {$set:{mfaRecoveryCodeHashes:codes.map(hashRecoveryCode)}}
    );
    if(rotation.modifiedCount!==1){res.status(409).json({error:{code:'MFA_STATE_CHANGED'}});return;}
    res.status(200).json({data:{recoveryCodes:codes,warning:'Previous recovery codes are now invalid. Store this new set securely.'}});
  }catch(error){next(error);}
});
