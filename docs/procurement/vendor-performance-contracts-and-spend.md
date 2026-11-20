# Vendor performance, contracts and procurement intelligence

## Vendor scorecards

Authenticated endpoint: `GET /api/v1/vendors/scorecards`.

Optional filters:
- `from=YYYY-MM-DD` and `to=YYYY-MM-DD` filter purchase-order issue dates.
- Facility visibility is derived from the caller's facility claims; owners and admins can view tenant-wide data.

Metrics are calculated from purchase orders and goods receipts:
- **On-time delivery:** completed orders with an expected date whose latest goods receipt was recorded on or before that date, divided by completed orders with an expected date.
- **Quality acceptance:** accepted received units divided by all received units. Damaged and quarantined units are not accepted.
- **Order fulfilment:** completed purchase orders divided by non-cancelled purchase orders.
- **Overall score:** delivery 40%, quality acceptance 30%, fulfilment 30%. If a metric has no denominator, it is omitted and remaining weights are normalized.

Scorecards are operational indicators, not audited supplier certifications. Only the latest 10,000 purchase orders are evaluated. Receipts without accurate timestamps or condition classification affect metric quality.

## Contract register and renewal management

Endpoints:
- `GET /api/v1/vendors/contracts`
- `POST /api/v1/vendors/contracts`
- `PATCH /api/v1/vendors/contracts/:id`
- `GET /api/v1/vendors/contracts/renewals?withinDays=90`

Contracts record supplier, contract number, title, type, start/end dates, renewal notice period, auto-renewal flag, annual value, currency, accountable owner and notes. Contract numbers are unique within a tenant. Vendor and accountable owner references are validated against the authenticated tenant. Create/update events are written to the audit ledger.

The renewal endpoint returns active contracts expiring within the requested 0–730 day window, the remaining days and whether the configured notice period has started. This is a visibility control, not an automated supplier notification or legal renewal instruction. Users must confirm contract terms and procurement authority before renewal. The current workflow records auto-renewal metadata; it does not automatically renew a contract.

## Procurement spend intelligence

Authenticated endpoint: `GET /api/v1/vendors/spend`.

Optional `from` and `to` filters use purchase-order issue dates. Output is grouped by supplier and currency, by currency overall, and by calendar month and currency.

The reported value is **committed procurement value**: purchase-order subtotal at issue date, excluding cancelled orders. It is not invoice-paid or cash-disbursed spend. No FX conversion, tax, freight adjustments, invoice reconciliation, credit notes or payment status are included. Values in different currencies must not be summed or compared as a single monetary total. Results are capped at 10,000 purchase orders.

## Access and limitations

All endpoints require an authenticated session and derive tenant identity from verified access claims. Facility-scoped users see only purchase orders within their assigned facilities. Contract create/update is limited to owner, admin and manager roles. Vendor contract changes are audit logged.

The current implementation calculates metrics on demand from purchase orders and goods receipt records. It does not yet provide invoice matching, supplier risk scoring, external sanctions checks, predictive delivery forecasts, automatic renewal emails or background recalculation snapshots.
