import { Schema, model, Types } from 'mongoose';

export interface InspectionChecklistItem {
  key: string;
  label: string;
  guidance?: string;
  required: boolean;
}
export interface InspectionTemplateRecord {
  tenantId: Types.ObjectId;
  facilityId?: Types.ObjectId;
  code: string;
  title: string;
  description?: string;
  category: 'safety' | 'condition' | 'compliance' | 'environmental' | 'quality' | 'other';
  items: InspectionChecklistItem[];
  active: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}
const itemSchema = new Schema<InspectionChecklistItem>({
  key:{type:String,required:true,trim:true,lowercase:true,maxlength:40},
  label:{type:String,required:true,trim:true,maxlength:180},
  guidance:{type:String,trim:true,maxlength:500},
  required:{type:Boolean,default:true,required:true}
},{_id:false});
const schema = new Schema<InspectionTemplateRecord>({
  tenantId:{type:Schema.Types.ObjectId,ref:'Tenant',required:true},
  facilityId:{type:Schema.Types.ObjectId,ref:'Facility'},
  code:{type:String,required:true,trim:true,uppercase:true,maxlength:40},
  title:{type:String,required:true,trim:true,maxlength:160},
  description:{type:String,trim:true,maxlength:2000},
  category:{type:String,enum:['safety','condition','compliance','environmental','quality','other'],required:true},
  items:{type:[itemSchema],validate:{validator:(v:InspectionChecklistItem[])=>v.length>0&&v.length<=60,message:'A template must contain 1 to 60 checklist items.'}},
  active:{type:Boolean,default:true,required:true},
  createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},
  updatedBy:{type:Schema.Types.ObjectId,ref:'User',required:true}
},{timestamps:true});
schema.index({tenantId:1,code:1},{unique:true});
schema.index({tenantId:1,facilityId:1,active:1});
export const InspectionTemplate=model<InspectionTemplateRecord>('InspectionTemplate',schema);
