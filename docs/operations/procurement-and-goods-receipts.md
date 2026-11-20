# Procurement and purchase management

ForgeOps connects replenishment requests to vendor orders and facility stock receipts.

## Lifecycle

1. A manager creates a draft purchase requisition for one facility, with spare-part lines, quantity, estimated unit cost, justification, and optional need-by date.
2. A manager submits the requisition. Submission freezes the workflow state for approval; only submitted requisitions can be approved or rejected.
3. An owner or administrator approves or rejects the submitted request. Rejection requires a reason.
4. A manager, owner, or administrator issues one purchase order from an approved requisition and selects an active tenant vendor. The order copies requested quantities and estimated costs and records a single currency.
5. An authorized facility user records one or more goods receipt notes (GRNs) against the order. A receipt cannot exceed the remaining ordered quantity.
6. Accepted goods create facility inventory receipts and append-only stock movement ledger entries. Damaged and quarantined quantities count as delivered against the PO but are not added to available stock.
7. The purchase order and requisition transition to partially received or received based on outstanding quantities.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/procurement/requisitions` | List facility-scoped requisitions; optional `status` filter |
| POST | `/api/v1/procurement/requisitions` | Create draft requisition |
| POST | `/api/v1/procurement/requisitions/:id/submit` | Submit for approval |
| POST | `/api/v1/procurement/requisitions/:id/approve` | Owner/admin approval |
| POST | `/api/v1/procurement/requisitions/:id/reject` | Owner/admin rejection with reason |
| GET | `/api/v1/procurement/purchase-orders` | List facility-scoped purchase orders |
| POST | `/api/v1/procurement/requisitions/:id/purchase-order` | Issue PO from approved requisition |
| GET | `/api/v1/procurement/goods-receipts` | List facility-scoped GRNs |
| POST | `/api/v1/procurement/purchase-orders/:id/receipts` | Record a partial or final goods receipt |

## Controls

- Tenant identity comes from the verified access token. Client-supplied tenant identifiers are never accepted.
- Facility scope is checked on every mutation and list query.
- Only active tenant parts and vendors can be referenced.
- Owner/admin approval is separate from manager requisition creation and submission.
- A requisition can produce at most one purchase order (tenant-scoped unique index).
- PO line quantities are bounded by the remaining ordered quantity. Purchase orders use Mongoose optimistic concurrency to reject conflicting concurrent document saves.
- Each requisition and receipt request contains at most one line per spare part to keep quantity reconciliation deterministic.
- Each accepted receipt increments the facility balance and appends a stock movement with GRN reference, vendor, unit cost, actor, before/after quantities, and reason.
- Damaged and quarantined items are recorded in the GRN but excluded from on-hand inventory.
- Audit events record requisition, PO, and GRN lifecycle changes.

## Consistency boundary

The workflow writes a GRN, PO, requisition, inventory balance, stock movement, and audit event across multiple MongoDB documents. This implementation validates the request before writes and uses atomic inventory increments plus optimistic concurrency for the PO, but it does **not** claim crash-safe cross-document ACID atomicity. For strict all-or-nothing behavior, deploy MongoDB as a replica set and wrap receipt processing in a MongoDB session transaction. A production rollout should also add idempotency keys for external delivery callbacks and a reconciliation job for interrupted receipts.

## Verification

`apps/api/test/procurement-integration.test.mjs` exercises draft → submit → approve → PO issue → partial receipt → final receipt, over-receipt rejection, stock posting, GRN persistence, and cross-tenant facility rejection. The CI workflow runs this alongside the existing API integration suite.
