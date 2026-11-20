# Notification centre and operational workflow alerts

## User inbox

Authenticated users can access their own notifications:

- `GET /api/v1/notifications?limit=20&page=1`
- `GET /api/v1/notifications?unread=true`
- `PATCH /api/v1/notifications/:notificationId/read`
- `PATCH /api/v1/notifications/read-all`

The inbox is scoped by both tenant and authenticated user. Notifications use a unique tenant/user/dedupe key so repeated scans do not create duplicate reminders.

## Operations scan

Managers, owners and administrators can request a scan:

- `POST /api/v1/notifications/dispatch`

The scan creates in-app reminders for:
- Assigned open/active work orders overdue or due in the next 24 hours.
- Active vendor contracts inside their configured renewal-notice window, routed to the contract owner.
- Open critical asset alerts, routed to tenant administrators and managers assigned to the affected facility.

Scans are bounded (500 work orders, 300 contracts and 300 critical alerts per run). The dispatch endpoint is a manual trigger in this release; it does not run on a background schedule. Repeated scans are idempotent for the same work-order state bucket, contract reminder and alert.

## Security and delivery boundaries

- No tenant or user identity is accepted from request bodies; verified access-token claims determine the inbox scope.
- Only managers and administrators can trigger an operations scan.
- Users can only read or update their own notifications.
- This release delivers in-app notifications only. Email, SMS, push delivery, user-configurable routing rules, automatic recurring scans and escalation timers are future work.
- Notifications are operational reminders, not proof that an SLA breach has been contractually adjudicated.
