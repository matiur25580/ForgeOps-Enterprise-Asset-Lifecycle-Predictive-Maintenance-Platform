import { Schema, model, Types } from 'mongoose';

export type WorkOrderType = 'corrective' | 'preventive' | 'inspection';
export type WorkOrderStatus = 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'emergency';

export interface WorkOrderRecord {
  tenantId: Types.ObjectId;
  facilityId: Types.ObjectId;
  assetId: Types.ObjectId;
  workOrderNumber: string;
  title: string;
  description?: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  assignedTo?: Types.ObjectId;
  scheduledStart?: Date;
  dueAt?: Date;
  estimatedHours?: number;
  actualHours?: number;
  completionNotes?: string;
  sourcePlanId?: Types.ObjectId;
  scheduledFor?: Date;
  sourceAlertId?: Types.ObjectId;
  sourceInspectionId?: Types.ObjectId;
  sourceInspectionScheduleId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  completedAt?: Date;
  laborCost?: number;
  externalServiceCost?: number;
  costCurrency: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const workOrderSchema = new Schema<WorkOrderRecord>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
  workOrderNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 4000 },
  type: { type: String, enum: ['corrective', 'preventive', 'inspection'], required: true },
  status: { type: String, enum: ['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled'], default: 'open', required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'emergency'], default: 'medium', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  scheduledStart: { type: Date },
  dueAt: { type: Date },
  estimatedHours: { type: Number, min: 0, max: 10000 },
  actualHours: { type: Number, min: 0, max: 10000 },
  completionNotes: { type: String, trim: true, maxlength: 4000 },
  sourcePlanId: { type: Schema.Types.ObjectId, ref: 'MaintenancePlan' },
  scheduledFor: { type: Date },
  sourceAlertId: { type: Schema.Types.ObjectId, ref: 'AssetAlert' },
  sourceInspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
  sourceInspectionScheduleId: { type: Schema.Types.ObjectId, ref: 'InspectionSchedule' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date },
  laborCost: { type: Number, min: 0, max: 100000000 },
  externalServiceCost: { type: Number, min: 0, max: 100000000 },
  costCurrency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: 'USD', required: true }
}, { timestamps: true });

workOrderSchema.index({ tenantId: 1, workOrderNumber: 1 }, { unique: true });
workOrderSchema.index({ tenantId: 1, facilityId: 1, status: 1, dueAt: 1 });
workOrderSchema.index({ tenantId: 1, assignedTo: 1, status: 1 });
workOrderSchema.index({ tenantId: 1, sourceAlertId: 1 }, { unique: true, partialFilterExpression: { sourceAlertId: { $type: 'objectId' } } });
workOrderSchema.index({ tenantId: 1, sourceInspectionId: 1 }, { unique: true, partialFilterExpression: { sourceInspectionId: { $type: 'objectId' } } });
workOrderSchema.index({ tenantId: 1, sourceInspectionScheduleId: 1, scheduledFor: 1 }, { unique: true, partialFilterExpression: { sourceInspectionScheduleId: { $type: 'objectId' }, scheduledFor: { $type: 'date' } } });
workOrderSchema.index(
  { tenantId: 1, sourcePlanId: 1, scheduledFor: 1 },
  { unique: true, partialFilterExpression: { sourcePlanId: { $type: 'objectId' }, scheduledFor: { $type: 'date' } } }
);

export const WorkOrder = model<WorkOrderRecord>('WorkOrder', workOrderSchema);
