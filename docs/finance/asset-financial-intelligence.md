# Asset financial intelligence

## API

The authenticated financial register is exposed at `GET /api/v1/financial/asset-register`.

Optional query parameters:
- `asOf=YYYY-MM-DD` — valuation date; defaults to current server date.
- `facilityId=<ObjectId>` — restricts results to a facility the caller can access.

The response contains:
- Asset acquisition basis and currency
- Accumulated depreciation, net book value and remaining depreciable value
- Warranty state: active, expiring soon (0–90 days), expired, or not recorded
- Completed maintenance cost by currency: labor, external service and linked spare-parts issue cost
- Portfolio valuation by currency, including acquisition cost, net book value, maintenance spend and TCO

Financial master data is maintained through the existing owner/admin/manager asset update endpoint `PATCH /api/v1/operations/assets/:assetId`. Supported fields include purchase cost, currency, salvage value, useful life in months, depreciation start date, depreciation method (currently straight-line only), warranty expiry, provider, reference and notes.

## Depreciation methodology

Straight-line depreciation is calculated as:

`monthly depreciation = (purchase cost − salvage value) / useful life in months`

Accumulated depreciation is prorated using elapsed calendar time from depreciation start date (or commissioning date when no separate start date is recorded), and capped at the depreciable basis. Net book value is acquisition cost less accumulated depreciation. A missing or zero useful life results in no calculated depreciation. Salvage value cannot exceed acquisition cost.

This is an operational book-value estimate. It is not a statutory tax schedule, impairment assessment, general-ledger posting, or substitute for an organization's approved accounting policy. The currently supported method is straight-line; declining-balance and units-of-production methods are not implemented.

## Warranty controls

Warranty status is evaluated as of the requested valuation date. Expiry within the next 90 days is classified as expiring soon. Missing expiry is classified as not recorded. Warranty provider, reference and notes are optional metadata and do not establish that a claim is covered or accepted by a supplier.

## Total cost of ownership

The current TCO estimate is acquisition cost plus completed work-order labor, external service and spare-parts issue costs linked to those completed work orders. Values remain grouped by currency. The system does not convert currencies or include tax, financing, depreciation expense, insurance, energy, facility overhead, disposal proceeds or unlinked maintenance costs. Do not compare cross-currency totals as if they shared a common base.

## Scope and limitations

- Asset register returns up to 5,000 assets per request; pagination and pre-aggregated financial snapshots are future scaling work.
- Maintenance spend includes completed work orders only.
- Spare-part cost attribution requires stock movements linked to a work order.
- Historical values are derived from current asset metadata and the existing work-order/stock-movement ledger; this is not an immutable accounting subledger.
- Review the source documents and accounting policy before using the figures for external financial reporting.
