# Spare parts, inventory and vendor workflows

Inventory API base: `/api/v1/inventory`. All routes require a verified bearer access token. Tenant identity is derived from token claims, and every part, vendor, balance, movement, facility and linked work order is checked against the caller's tenant and facility scope.

## Vendor directory

| Method | Endpoint | Access |
|---|---|---|
| GET | `/vendors` | Authenticated |
| POST | `/vendors` | Owner, admin, manager |
| PATCH | `/vendors/:vendorId` | Owner, admin, manager |

Vendor codes are unique within a tenant. Vendor status supports active, inactive and under-review. Spare parts can reference an active preferred vendor.

## Spare parts catalog

| Method | Endpoint | Access |
|---|---|---|
| GET | `/parts` | Authenticated |
| POST | `/parts` | Owner, admin, manager |

Parts are tenant-wide catalog records. A tenant-scoped unique part number identifies the catalog item; stock is held separately at each facility. Unit of measure supports each, box, liter, kilogram, meter and set.

## Facility inventory

| Method | Endpoint | Access |
|---|---|---|
| GET | `/balances?facilityId=:id` | Authenticated, facility-scoped |
| GET | `/movements?facilityId=:id` | Authenticated, facility-scoped |
| POST | `/movements` | Owner, admin, manager, technician |

Movement types:
- `receipt`: positive quantity; may reference a vendor, purchase reference and unit cost
- `issue`: positive quantity consumed from on-hand stock; may link to a work order in the same tenant and facility
- `adjustment`: signed quantity for a documented count correction; cannot reduce on-hand below zero

Each balance is uniquely keyed by tenant, facility and spare part. Stock updates use an atomic conditional MongoDB update to prevent concurrent issues from taking on-hand below zero. Each movement records quantity before/after, actor, reason, reference, cost and optional vendor/work-order linkage. A failed ledger/audit write triggers a compensating balance update. For strict multi-document ACID guarantees under process crashes, deploy MongoDB as a replica set and move balance, ledger and audit writes into a session transaction; this release does not claim that cross-document crash atomicity.

## Reorder monitoring

A balance stores a reorder point and optional bin location. The UI highlights balances where on-hand quantity is at or below the reorder point. It is an operational warning, not an automatically generated purchase order.

## Angular workspace

The authenticated Inventory & MRO page provides:
- Vendor registration and supplier directory
- Spare part catalog creation
- Facility stock balance view and low-stock highlighting
- Receipt, issue and adjustment entry
- Movement ledger with quantity before/after and source reference

## Verification

Run `npm test` for API unit and MongoDB-memory integration suites. Inventory integration coverage exercises vendor and part creation, receipt, work-order-linked issue, ledger/balance reconciliation, insufficient-stock rejection and cross-tenant reference rejection.
