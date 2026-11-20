import nodemailer from 'nodemailer';
import {env} from '../config/env.js';
let transport: nodemailer.Transporter | null=null;
export function emailTransportConfigured(){return Boolean(env.SMTP_HOST&&env.SMTP_FROM);}
function getTransport(){
 if(!emailTransportConfigured())return null;
 if(!transport)transport=nodemailer.createTransport({host:env.SMTP_HOST,port:env.SMTP_PORT,secure:env.smtpSecure,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS}:undefined});
 return transport;
}
export async function sendNotificationEmail(input:{to:string;subject:string;text:string;html:string}){
 const client=getTransport();if(!client)return {skipped:true as const};
 const result=await client.sendMail({from:env.SMTP_FROM,to:input.to,subject:input.subject,text:input.text,html:input.html});
 return {skipped:false as const,messageId:result.messageId};
}
