# Operations analytics and maintenance KPIs

## Endpoint

Authenticated endpoint: `GET /api/v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&facilityId=<id>`.

The default reporting window is the previous 30 days through the current time. Date-only `to` values include the full UTC day. The API applies tenant scope from the verified access token and facility scope from the user's authorized facility claims. Owners/admins may optionally filter by a tenant-owned facility.

## Delivered indicators

- Asset count: non-archived assets in the selected tenant/facility scope.
- Work-order throughput: work orders created in the selected period, completed in the period (using completion timestamp), and current open/overdue backlog.
- Status and priority distributions: current work-order state and current open backlog priority.
- MTTR proxy: average elapsed wall-clock hours between corrective work-order creation and completion.
- MTBF proxy: average interval between successive completed corrective work-order creation timestamps for the same asset.
- Parts issue cost: issued quantity multiplied by recorded movement unit cost where available.
- Monthly created/completed work-order trend.

## Interpretation and limits

These metrics are deliberately transparent and must not be presented as verified equipment reliability or accounting figures:

- MTTR is work-order elapsed time, not technician labor time.
- MTBF assumes corrective work orders are consistently logged for each failure; unrecorded failures are invisible.
- Repair elapsed time is only a work-order proxy for downtime. The current platform does not yet have explicit equipment downtime events and scheduled operating-hour calendars, so verified downtime and availability are not calculated.
- Parts cost includes only stock issue movements with a unit cost. Labor, overhead, tax, receipts, and mixed-currency conversion are excluded. The API explicitly labels the unit-cost currency caveat.
- Empty reliability samples return `null`, not a fabricated zero.
- Large reports are currently capped at 20,000 work orders per query; dedicated aggregation and time-series rollups are future optimization work.

## Frontend

The protected `/analytics` Angular workspace provides date filtering, operational KPI cards, backlog priority distribution, monthly work-order trend, status breakdown, and an in-product metric methodology note. It is a live API-backed workspace; no illustrative dashboard KPI values are substituted into this page.
