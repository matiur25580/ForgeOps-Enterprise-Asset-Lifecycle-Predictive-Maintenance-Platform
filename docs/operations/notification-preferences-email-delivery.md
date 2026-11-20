# Notification preferences, SMTP delivery and audit history

## Capabilities

ForgeOps supports optional email delivery for operational notifications. In-app notifications remain the primary inbox and continue working without SMTP credentials.

### User preferences

Authenticated users can manage their own preferences:

- `GET /api/v1/notification-settings/preferences`
- `PUT /api/v1/notification-settings/preferences`

Settings include email opt-in, per-category switches (SLA, contract renewal, critical asset alerts and maintenance), timezone-aware quiet hours and an IANA timezone. Preferences are tenant/user scoped. Email is disabled by default.

### Delivery audit

- `GET /api/v1/notification-settings/deliveries?page=1&limit=20`

The delivery ledger records the recipient, channel, status, attempt count, provider message ID, sent time and a bounded error reason. A unique tenant/notification/channel index prevents duplicate delivery records.

### SMTP configuration

Set these optional environment variables on both API and worker services:

- `SMTP_HOST`
- `SMTP_PORT` (default 587)
- `SMTP_SECURE` (`true` for implicit TLS, otherwise `false`)
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (valid sender email address)

Use a dedicated SMTP credential, store it as a deployment secret and never commit it. If SMTP is not configured, email delivery is recorded as skipped and the in-app notification remains available.

## Delivery flow

1. An operations scan creates a deduplicated in-app notification.
2. If the recipient has opted into email and enabled that category, an email job is enqueued.
3. The background worker checks the recipient, category preference and quiet-hours window.
4. Nodemailer sends through the configured SMTP transport.
5. The delivery ledger records sent, skipped or failed status. Transient SMTP errors flow through the durable job retry policy.

Quiet-hours suppression is recorded as skipped rather than silently discarded. This release does not automatically send a deferred email after quiet hours; the in-app notification remains visible.

## Operational and security boundaries

- SMTP delivery is optional and provider-neutral; no credentials or provider account are included in this repository.
- Email content is generated from escaped notification text. Do not put secrets or sensitive personal data in notification messages.
- Preference and delivery history endpoints are scoped to the authenticated tenant and user.
- Email is disabled by default; category preferences default to enabled only after the user explicitly enables email.
- Delivery is at-least-once at the job layer. SMTP providers may accept a message before a network timeout; operators should monitor duplicate-risk cases.
- SMS, push, digest emails, user-configurable escalation timers and delivery-provider webhooks remain future work.
