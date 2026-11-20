# Telemetry alerts and maintenance response

## Overview

ForgeOps evaluates each persisted telemetry reading against the tenant's configured metric rule. If no tenant rule exists, the API uses documented baseline thresholds. The evaluator opens an alert when a reading crosses a warning or critical boundary and refreshes an existing open/acknowledged alert for the same asset and metric rather than creating a new alert for every sample.

This is threshold-based condition monitoring, not a trained predictive model. Simulated telemetry remains labelled `simulator`.

## Default thresholds

| Metric | Warning | Critical | Direction |
|---|---:|---:|---|
| Temperature | 75 °C | 90 °C | Higher is worse |
| Vibration | 4.5 mm/s | 7.1 mm/s | Higher is worse |
| Pressure | 2 bar | 1 bar | Lower is worse |
| Current | 80 A | 100 A | Higher is worse |

Tenant rules override defaults. Rule writes require owner, admin or manager and validate that the critical boundary is more severe than warning.

## Alert lifecycle

- `open`: newly detected threshold breach.
- `acknowledged`: an authorized operator has accepted responsibility.
- `resolved`: a manager/administrator has closed the alert after review.

A new breach refreshes an existing open or acknowledged alert for the same tenant, asset and metric. Resolved alerts remain in history; a later breach can create a new alert.

## API

All routes are under `/api/v1` and require a bearer access token.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/alerts` | List alerts, optional status/severity/facility filters |
| GET | `/alerts/rules` | List tenant threshold overrides |
| PUT | `/alerts/rules/:metric` | Create/update a metric rule |
| PATCH | `/alerts/:alertId/acknowledge` | Acknowledge an open alert |
| PATCH | `/alerts/:alertId/resolve` | Resolve an alert |
| POST | `/alerts/:alertId/work-order` | Create and link a corrective work order |

Telemetry simulation evaluates saved readings immediately and returns alert creation/refresh counts. Alert and work-order operations enforce tenant and facility scope. Alert acknowledgement and resolution produce audit events. A linked alert returns the existing work order on repeat requests, avoiding duplicate UI actions.

## Operational notes and limitations

- Rule configuration is tenant-wide per metric; per-asset and per-facility overrides are not implemented.
- Alert deduplication is application-level; a distributed high-volume ingestion deployment should add a dedicated idempotency/unique-key strategy and background queue.
- The work-order link is persisted on the alert and protected by the API's existing access checks. MongoDB transactions are not claimed for the cross-document alert/work-order/audit sequence.
- Notifications, escalation timers, email/SMS delivery and alert suppression windows remain future work.
- The UI currently exposes temperature threshold editing; the API supports all four metrics.
