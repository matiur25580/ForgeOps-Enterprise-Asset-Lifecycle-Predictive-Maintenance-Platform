# Enterprise reporting and export centre

ForgeOps provides authenticated CSV exports for four operational registers:

- **Work orders** — status, priority, facility/asset references, assignment, dates and recorded maintenance costs.
- **Downtime** — cause, resolution, verification status and actor references.
- **Inspections** — template snapshot, pass/fail outcome, finding count and review decision.
- **Purchase orders** — supplier/facility references, currency, committed subtotal and expected date. Cancelled orders are excluded.

## API

- `GET /api/v1/reports/catalog`
- `GET /api/v1/reports/exports/work-orders.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/reports/exports/downtime.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/reports/exports/inspections.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/reports/exports/purchase-orders.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`

Optional `facilityId` narrows the export. The tenant comes only from the verified access token. Non-admin users are restricted to their assigned facilities; supplied facility IDs are checked against that scope. Date ranges are inclusive for date-only values, limited to 366 days, and each export is capped at 10,000 rows. Responses are private/no-store CSV with UTF-8 BOM for spreadsheet compatibility.

## Data and security boundaries

- CSV fields are quoted and embedded quotes doubled. Values beginning with spreadsheet formula prefixes (=, +, -, @) are prefixed with an apostrophe to reduce formula-injection risk.
- IDs are exported as references; personal names and email addresses are not included.
- Purchase order values represent procurement commitments, not invoices paid or cash expenditure.
- Exports are synchronous and capped; background generation, PDF rendering, scheduled delivery and email distribution are future capabilities.
- Date filtering uses the record's domain timestamp: work-order creation, downtime start, inspection performance or purchase-order issue time.
