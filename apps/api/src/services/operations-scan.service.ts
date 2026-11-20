import { Types } from 'mongoose';
import { Notification } from '../models/notification.model.js';
import { NotificationPreference } from '../models/notification-preference.model.js';
import { NotificationEscalationPolicy } from '../models/notification-escalation-policy.model.js';
import { WorkOrder } from '../models/work-order.model.js';
import { VendorContract } from '../models/vendor-contract.model.js';
import { AssetAlert } from '../models/asset-alert.model.js';
import { User } from '../models/user.model.js';
import { enqueueBackgroundJob } from './background-jobs.service.js';

type OperationalCategory = 'sla' | 'contract' | 'asset_alert';
type OperationalResource = 'work_order' | 'vendor_contract' | 'asset_alert';

async function createNotification(input: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  facilityId?: Types.ObjectId;
  category: OperationalCategory;
  title: string;
  message: string;
  severity: 'warning' | 'critical';
  resourceType: OperationalResource;
  resourceId: Types.ObjectId;
  dedupeKey: string;
}) {
  try {
    const result = await Notification.updateOne(
      { tenantId: input.tenantId, userId: input.userId, dedupeKey: input.dedupeKey },
      { $setOnInsert: input },
      { upsert: true }
    );

    if (result.upsertedCount) {
      const [notification, preference] = await Promise.all([
        Notification.findOne({
          tenantId: input.tenantId,
          userId: input.userId,
          dedupeKey: input.dedupeKey
        }).select('_id').lean(),
        NotificationPreference.findOne({
          tenantId: input.tenantId,
          userId: input.userId
        }).lean()
      ]);

      if (notification && preference?.emailEnabled && preference.categories[input.category]) {
        await enqueueBackgroundJob({
          tenantId: input.tenantId,
          type: 'notification_email',
          dedupeKey: 'notification-email:' + notification._id,
          payload: { notificationId: notification._id, requestedBy: input.userId }
        });
      }
    }

    return result.upsertedCount ?? 0;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error &&
      (error as { code?: number }).code === 11000) return 0;
    throw error;
  }
}

export async function runOperationsScan(tenantIdValue: string, facilityIds?: string[]) {
  const tenantId = new Types.ObjectId(tenantIdValue);
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const facilityFilter = facilityIds
    ? { facilityId: { $in: facilityIds.map((id) => new Types.ObjectId(id)) } }
    : {};

  const orders = await WorkOrder.find({
    tenantId,
    ...facilityFilter,
    status: { $in: ['open', 'assigned', 'in_progress'] },
    assignedTo: { $exists: true, $ne: null },
    dueAt: { $lte: soon }
  }).select('_id facilityId assignedTo workOrderNumber title dueAt').limit(500).lean();

  let created = 0;
  let escalationsCreated = 0;
  const savedPolicy = await NotificationEscalationPolicy.findOne({ tenantId }).lean();
  const policy = savedPolicy ?? {
    enabled: true,
    overdueAfterMinutes: 240,
    notifyTenantAdmins: true,
    notifyFacilityManagers: true
  };

  for (const workOrder of orders) {
    if (!workOrder.dueAt || !workOrder.assignedTo) continue;
    const overdue = workOrder.dueAt < now;

    created += await createNotification({
      tenantId,
      userId: workOrder.assignedTo,
      facilityId: workOrder.facilityId,
      category: 'sla',
      title: overdue ? 'Work order SLA breached' : 'Work order due within 24 hours',
      message: workOrder.workOrderNumber + ' · ' + workOrder.title +
        ' · due ' + workOrder.dueAt.toISOString(),
      severity: overdue ? 'critical' : 'warning',
      resourceType: 'work_order',
      resourceId: workOrder._id,
      dedupeKey: 'work-order:' + workOrder._id + ':' +
        (overdue ? 'overdue' : 'due-soon') + ':' + workOrder.dueAt.toISOString()
    });

    const overdueMinutes = (now.getTime() - workOrder.dueAt.getTime()) / 60000;
    if (!overdue || !policy.enabled || overdueMinutes < policy.overdueAfterMinutes) continue;

    const recipientFilters: Record<string, unknown>[] = [];
    if (policy.notifyTenantAdmins) recipientFilters.push({ role: { $in: ['owner', 'admin'] } });
    if (policy.notifyFacilityManagers) {
      recipientFilters.push({ role: 'manager', facilityIds: workOrder.facilityId });
    }
    if (recipientFilters.length === 0) continue;

    const recipients = await User.find({
      tenantId,
      status: 'active',
      $or: recipientFilters
    }).select('_id').limit(100).lean();

    for (const recipient of recipients) {
      escalationsCreated += await createNotification({
        tenantId,
        userId: recipient._id,
        facilityId: workOrder.facilityId,
        category: 'sla',
        title: 'Work order SLA escalation',
        message: workOrder.workOrderNumber + ' · ' + workOrder.title +
          ' has been overdue for at least ' + policy.overdueAfterMinutes +
          ' minutes. Escalated for management review.',
        severity: 'critical',
        resourceType: 'work_order',
        resourceId: workOrder._id,
        dedupeKey: 'work-order-escalation:' + workOrder._id + ':' +
          workOrder.dueAt.toISOString() + ':' + policy.overdueAfterMinutes
      });
    }
  }

  const contracts = await VendorContract.find({
    tenantId,
    status: 'active',
    endDate: { $gte: now, $lte: new Date(now.getTime() + 730 * 86400000) }
  }).select('_id ownerUserId contractNumber title endDate renewalNoticeDays').limit(500).lean();

  let contractCount = 0;
  for (const contract of contracts) {
    if (contract.endDate.getTime() - now.getTime() > contract.renewalNoticeDays * 86400000) continue;
    contractCount += await createNotification({
      tenantId,
      userId: contract.ownerUserId,
      category: 'contract',
      title: 'Vendor contract renewal reminder',
      message: contract.contractNumber + ' · ' + contract.title +
        ' ends ' + contract.endDate.toISOString().slice(0, 10),
      severity: 'warning',
      resourceType: 'vendor_contract',
      resourceId: contract._id,
      dedupeKey: 'contract:' + contract._id + ':renewal:' +
        contract.endDate.toISOString().slice(0, 10)
    });
  }

  const alerts = await AssetAlert.find({
    tenantId,
    status: 'open',
    severity: 'critical',
    ...facilityFilter
  }).select('_id facilityId message').limit(300).lean();

  let alertCount = 0;
  for (const alert of alerts) {
    const recipients = await User.find({
      tenantId,
      status: 'active',
      $or: [
        { role: { $in: ['owner', 'admin'] } },
        { role: 'manager', facilityIds: alert.facilityId }
      ]
    }).select('_id').limit(50).lean();

    for (const recipient of recipients) {
      alertCount += await createNotification({
        tenantId,
        userId: recipient._id,
        facilityId: alert.facilityId,
        category: 'asset_alert',
        title: 'Critical asset alert requires attention',
        message: alert.message,
        severity: 'critical',
        resourceType: 'asset_alert',
        resourceId: alert._id,
        dedupeKey: 'critical-alert:' + alert._id
      });
    }
  }

  return {
    workOrdersScanned: orders.length,
    contractsScanned: contracts.length,
    criticalAlertsScanned: alerts.length,
    notificationsCreated: created + contractCount + alertCount + escalationsCreated,
    escalationsCreated
  };
}
