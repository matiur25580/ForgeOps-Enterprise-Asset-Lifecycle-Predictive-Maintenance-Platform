# Verified downtime, availability and maintenance cost accounting

## Downtime event lifecycle

Authenticated endpoints are mounted under `/api/v1/downtime`:

- `GET /events` — tenant/facility-scoped event register, filterable by asset, status, verification status and start range.
- `POST /events` — report an event against a tenant-owned asset; optional work order must reference the same asset and facility.
- `PATCH /events/:eventId/resolve` — close an open event with an end timestamp.
- `PATCH /events/:eventId/verify` — owner/admin/manager independently verifies or rejects a resolved event. The original reporter cannot verify their own event; rejection requires a note.

Only resolved, independently verified events are included in availability. A second open event for the same asset is rejected. Event creation, resolution and verification produce audit events. Technicians may report downtime and resolve their own reports; reviewers must be owner/admin/manager.

## Operating calendar and availability

Assets may set `scheduledOperatingHoursPerWeek` (0–168). The reporting API computes scheduled operating minutes as configured weekly hours multiplied by the reporting interval divided by 7 days. It then subtracts the union of overlapping, verified downtime intervals for those assets and reports a schedule-weighted availability percentage.

The current schedule model spreads weekly operating hours evenly over the week. This is a transparent approximation, not shift-calendar arithmetic. Assets without a positive weekly schedule are reported as unmeasured and excluded from the denominator. If no assets have schedules, availability is `null`, not 0% or 100%.

Planned maintenance and inspection downtime are separated from unplanned breakdown, utility and other causes. Overlapping intervals for the same asset are merged to avoid double counting. Event times are clipped to the reporting window.

## Maintenance cost accounting

Work orders can record `laborCost`, `externalServiceCost` and `costCurrency`. Spare parts carry their own currency, and the stock movement ledger now snapshots that currency at movement time. Analytics groups labor, external service and issued-parts cost by currency and does not sum unlike currencies into a misleading single total.

Costs are entered amounts, not payroll or invoice integrations. Tax, overhead, depreciation, purchase receipts, exchange rates and currency conversion are excluded. The work-order cost fields should be entered only when supported by an approved internal estimate, timesheet or supplier invoice.

## Data and reporting boundaries

- MTTR and MTBF remain work-order-derived indicators with the definitions stated in the analytics workspace.
- Availability is calculated only from verified downtime and configured weekly operating hours.
- Unverified, open or rejected downtime events do not affect availability.
- Cost totals are grouped by ISO-style three-letter currency codes; no cross-currency total is produced.
- Analytics still caps the work-order scan at 20,000 records per query. Large tenants should move to pre-aggregated reporting collections before scaling beyond this bound.
