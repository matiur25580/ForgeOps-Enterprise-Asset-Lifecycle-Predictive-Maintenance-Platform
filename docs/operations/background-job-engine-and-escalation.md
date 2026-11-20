# Background job engine and automatic workflow scans

## Architecture

ForgeOps uses MongoDB as a durable job store in this release. A worker process polls for due work and claims one job atomically using `findOneAndUpdate`. Each job has a tenant, type, deduplication key, attempt counter, availability timestamp and expiring worker lease.

## Scheduled operations scans

The worker schedules one operations scan per active tenant every five minutes. A tenant-scoped unique deduplication key prevents duplicate scheduled jobs within a time slot. The scan creates in-app notifications for:

- Assigned work orders due within 24 hours or overdue.
- Vendor contracts inside their configured renewal-notice window.
- Open critical asset alerts for tenant admins and managers assigned to the affected facility.

The scheduler and worker are separate from HTTP request handling. Manual scans enqueue jobs and return HTTP 202; the UI confirms the job identifier. A requester can inspect the job status through `GET /api/v1/notifications/dispatch/:jobId`.

## Retry and delivery semantics

- Jobs default to five attempts.
- Failed jobs are retried with exponential backoff, capped at one hour.
- A worker lease expires after two minutes; another worker can reclaim abandoned work.
- Completed/failed job records are retained for 30 days, then pruned by the worker.
- Notification upserts use tenant/user/dedupe keys, making repeated scans safe against duplicate in-app notifications.
- This is at-least-once job execution, not exactly-once processing. Handlers must remain idempotent.

## Run locally

Start the API and web app as usual, then run a third terminal:

```bash
npm run dev:worker
```

Production worker command after building:

```bash
npm run build --workspace @forgeops/api
npm run start:worker --workspace @forgeops/api
```

Deploy the API as a web service and this worker command as a separate long-running background worker. Both must share the same MongoDB database and application secrets. Do not deploy two worker processes with different databases.

## Operations and safety

The worker handles SIGINT/SIGTERM by stopping new polling, finishing its current job, and disconnecting MongoDB. Monitor worker logs, failed job counts and oldest queued-job age. The worker does not send email, SMS or push messages in this phase; notifications remain in-app. SMTP/provider credentials and external delivery retries are future work.
