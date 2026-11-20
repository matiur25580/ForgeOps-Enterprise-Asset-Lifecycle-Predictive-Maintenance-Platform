import { Schema, model, Types } from 'mongoose';

export interface InspectionResponse {
  itemKey:string;
  result:'pass'|'fail'|'not_applicable';
  notes?:string;
  evidenceReference?:string;
}
export interface InspectionRecord {
  tenantId:Types.ObjectId;
  facilityId:Types.ObjectId;
  assetId:Types.ObjectId;
  templateId:Types.ObjectId;
  templateSnapshot:{code:string;title:string;category:string;items:Array<{key:string;label:string;required:boolean}>};
  inspectionNumber:string;
  status:'completed'|'voided';
  responses:InspectionResponse[];
  overallResult:'pass'|'fail';
  findingsCount:number;
  correctiveWorkOrderId?:Types.ObjectId;
  performedBy:Types.ObjectId;
  performedAt:Date;
  reviewedBy?:Types.ObjectId;
  reviewedAt?:Date;
  reviewStatus:'pending'|'approved'|'rejected';
  reviewNotes?:string;
}
const responseSchema=new Schema<InspectionResponse>({
 itemKey:{type:String,required:true},result:{type:String,enum:['pass','fail','not_applicable'],required:true},
 notes:{type:String,trim:true,maxlength:2000},evidenceReference:{type:String,trim:true,maxlength:500}
},{_id:false});
const schema=new Schema<InspectionRecord>({
 tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true},
 facilityId:{type:Schema.Types.ObjectId,ref:'Facility',required:true},
 assetId:{type:Schema.Types.ObjectId,ref:'Asset',required:true},
 templateId:{type:Schema.Types.ObjectId,ref:'InspectionTemplate',required:true},
 templateSnapshot:{code:{type:String,required:true},title:{type:String,required:true},category:{type:String,required:true},items:{type:[{key:String,label:String,required:Boolean}],required:true}},
 inspectionNumber:{type:String,required:true,trim:true,uppercase:true,maxlength:48},
 status:{type:String,enum:['completed','voided'],default:'completed',required:true},
 responses:{type:[responseSchema],required:true},
 overallResult:{type:String,enum:['pass','fail'],required:true},
 findingsCount:{type:Number,min:0,required:true},
 correctiveWorkOrderId:{type:Schema.Types.ObjectId,ref:'WorkOrder'},
 performedBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
 performedAt:{type:Date,required:true},
 reviewedBy:{type:Schema.Types.ObjectId,ref:'User'},
 reviewedAt:{type:Date},
 reviewStatus:{type:String,enum:['pending','approved','rejected'],default:'pending',required:true},
 reviewNotes:{type:String,trim:true,maxlength:2000}
},{timestamps:true});
schema.index({tenantId:1,inspectionNumber:1},{unique:true});
schema.index({tenantId:1,facilityId:1,performedAt:-1});
schema.index({tenantId:1,assetId:1,performedAt:-1});
export const Inspection=model<InspectionRecord>('Inspection',schema);
