# Facility and asset registry API

This module introduces the first operational domain for ForgeOps. Facilities are tenant-owned boundaries; assets belong to one facility and carry a tenant-scoped asset tag.

## Authentication and authorization

Every endpoint requires a verified bearer access token. The tenant ID is always taken from the token; clients cannot submit or override it.

- Owner / admin: read all facilities and assets in their tenant; create and update facilities; create, update, and archive assets.
- Manager: read assets only in facilities assigned to the user; create, update, and archive assets only in assigned facilities.
- Technician / viewer: read-only access to assets and facilities assigned to the user.
- A facility outside the caller's tenant is never returned. Asset detail lookups intentionally return 404 when the asset is outside tenant or facility scope.

Facility assignments are embedded in the signed access-token claims. When assignments change, issue a new access token/session so the new scope is reflected.

## Endpoints

All paths are under /api/v1/operations.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /facilities | List facilities visible to the caller |
| POST | /facilities | Create a facility (owner/admin) |
| PATCH | /facilities/:facilityId | Update a facility (owner/admin) |
| GET | /assets | Paginated asset search and filters |
| POST | /assets | Register an asset (owner/admin/manager) |
| GET | /assets/:assetId | Retrieve an in-scope asset |
| GET | /assets/:assetId/audit | Read the latest 100 audit events for an asset |
| PATCH | /assets/:assetId | Update an asset (owner/admin/manager) |
| DELETE | /assets/:assetId | Soft-archive an asset (owner/admin/manager) |

### Asset list query parameters

- page (default 1), limit (default 25, maximum 100)
- facilityId
- lifecycleStatus: commissioning, operational, maintenance, retired, disposed
- criticality: low, medium, high, critical
- category
- q: case-insensitive match against asset tag, name, or serial number

## Data integrity and audit

- Facility code is unique within a tenant.
- Asset tag is unique within a tenant, not globally.
- Asset serial number has a tenant-scoped sparse index.
- Parent assets must be active and in the same tenant and facility.
- Asset deletion is a soft archive; operational records are retained.
- Create, update, and archive operations write audit events with actor, tenant, facility, entity, action, and changed field names.
- Search input is escaped before use in regular expressions; list results are bounded and paginated.

## Example asset registration

    POST /api/v1/operations/assets
    Authorization: Bearer <access-token>
    Content-Type: application/json

    {
      "facilityId": "64f000000000000000000001",
      "assetTag": "PUMP-001",
      "name": "Cooling Water Pump",
      "category": "rotating-equipment",
      "manufacturer": "Acme Industrial",
      "criticality": "critical",
      "lifecycleStatus": "operational",
      "condition": "good",
      "purchaseCost": 12500,
      "currency": "INR"
    }

## Current boundaries

This release establishes facility and asset master data, scoped CRUD, soft archival, and audit events. It does not yet implement work orders, telemetry ingestion, predictive models, asset depreciation, or a full audit export/retention workflow. Audit writes are currently performed alongside domain writes; transaction-backed atomicity is a future hardening task for deployments that use a replica set.
