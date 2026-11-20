# Audit and compliance explorer

## Purpose

The audit explorer provides a read-only, paginated view of recorded operational changes. It helps operations leaders investigate asset, work-order, inspection, downtime, procurement and alert workflows without granting write access to the audit ledger.

## Endpoint

`GET /api/v1/audit-events`

Supported query parameters:

| Parameter | Meaning |
|---|---|
| `page` | Page number, starting at 1 (default 1) |
| `limit` | Page size, 1–100 (default 25) |
| `entityType` | Filter by supported audited entity |
| `action` | `created`, `updated`, `archived`, `acknowledged`, `resolved` |
| `actorUserId` | Filter by actor ObjectId |
| `facilityId` | Filter by facility ObjectId |
| `from` / `to` | Inclusive ISO date/time range; date-only `to` includes that full day |

The response contains events, actor display context and pagination totals. Change payloads are recursively bounded and redact credential-shaped keys such as passwords, tokens, secrets, cookies, authorization headers and private keys.

## Authorization and data boundaries

- Only tenant owners, administrators and facility managers can use the explorer.
- Owners and administrators can query tenant history.
- Managers are restricted to facility IDs in their verified access-token claims; an explicitly requested unassigned facility returns 403.
- Every query is tenant-scoped. Actor enrichment is also tenant-scoped.
- The API exposes no create, update or delete endpoint for audit events.
- The Angular explorer is read-only and offers entity, action and date filters with pagination.

## Data quality and limitations

Audit events are written by domain workflows when those workflows explicitly create an audit record. The explorer does not imply that every read or every database mutation is audited. Audit writes are currently performed in the same request flow as domain changes but are not universally wrapped in MongoDB transactions; production deployments should add transaction-backed mutation/audit commits where supported, append-only database permissions, retention controls and external immutable archival.

The current audit model stores an action, actor, entity, optional facility, timestamp and a structured change summary. Some existing workflows record changed field names rather than before/after values. This is intentional where storing full values could expose sensitive operational data.
