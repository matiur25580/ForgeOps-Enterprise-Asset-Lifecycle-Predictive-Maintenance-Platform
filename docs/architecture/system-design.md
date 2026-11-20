# ForgeOps System Design

## 1. Architecture decision

ForgeOps starts as a **modular monolith** with a separately deployed Angular web client and Express API. Domain modules have explicit boundaries and communicate through application services and domain events. This avoids the operational overhead of premature microservices while keeping future extraction possible.

## 2. Logical components

| Component | Responsibility |
|---|---|
| Angular web | Role-aware user experience, forms, dashboards, charts, live updates |
| API edge | Routing, request IDs, rate limits, authentication middleware, validation |
| Identity | Users, sessions, MFA, invitations, roles, permissions |
| Tenant administration | Organizations, facilities, tenant lifecycle and plan limits |
| Asset management | Asset hierarchy, classification, documents, lifecycle |
| Maintenance | Requests, plans, work orders, tasks, approvals, SLA |
| Inventory | Parts, warehouses, reservations, stock movements |
| Inspection & compliance | Templates, checklists, findings, corrective actions |
| Vendor management | Suppliers, service contracts, warranties |
| Telemetry | Ingestion adapters, readings, threshold evaluation, device status |
| Analytics | Operational metrics, aggregations, report generation |
| Notifications | In-app and email delivery adapters |
| Audit | Append-only record of security and business-critical actions |

## 3. Tenant isolation model

1. Authentication identifies the user.
2. Server-side tenant resolution determines the active organization from a validated membership/context.
3. Authorization checks tenant membership, role, permission, and applicable facility scope.
4. Repository/service methods require tenant context for tenant-owned resources.
5. Database queries include the tenant identifier; client-provided tenant IDs are never trusted as proof of access.
6. Automated tests attempt cross-tenant reads, updates, deletes, exports, and indirect object references.

Tenant-owned collections should include a required `tenantId`. Unique indexes for tenant-scoped business identifiers should include `tenantId` in the compound key.

## 4. Data design guidance

- Use MongoDB references for independently managed entities and bounded embedded documents for small, aggregate-owned data.
- Add compound indexes beginning with `tenantId` for common tenant-scoped queries.
- Use pagination for list endpoints; avoid unbounded collection reads.
- Use MongoDB transactions for workflows that must update multiple documents atomically.
- Keep audit events append-only at the application level and restrict update/delete permissions.
- Store large files in object storage; persist metadata and access references in MongoDB.
- Treat telemetry as high-volume time-series data with retention and aggregation policies.

## 5. API conventions

- Prefix endpoints with `/api/v1`.
- Use resource-oriented nouns and consistent HTTP methods.
- Validate path, query, and body inputs at the API boundary.
- Return a consistent error envelope with a stable machine-readable code and request ID.
- Enforce authorization on the server for every protected operation.
- Document request/response contracts with OpenAPI.
- Use idempotency keys for retry-sensitive commands such as work-order creation from external integrations.

## 6. Real-time and background work

Socket.IO is used for authorized live updates such as work-order status and alert notifications. A WebSocket connection must be authenticated and scoped to the user's tenant and permitted facilities.

Long-running work—report generation, notification delivery, telemetry aggregation, and imports—should run through a background-job abstraction. The first implementation may use a MongoDB-backed job adapter; the interface should allow a durable queue to be introduced when operational requirements justify it.

## 7. Telemetry and predictive maintenance boundaries

The first milestone uses a simulator that produces clearly labelled synthetic readings. A telemetry adapter normalizes device payloads before persistence. Rules evaluate configured thresholds and create alerts with severity, evidence, timestamps, and lifecycle state.

A risk score is an explainable heuristic until validated historical failure data exists. The product must not present simulated readings or heuristic scores as verified real-world predictions.

## 8. Reliability and observability

- Structured logs with request and correlation IDs.
- Health and readiness endpoints that do not disclose secrets.
- Metrics for latency, error rate, job failures, and database health.
- Explicit timeouts and bounded retries for external dependencies.
- Graceful shutdown and connection cleanup.
- Documented backup, restore, and retention procedures.

## 9. Security baseline

- Secure password hashing and account recovery.
- Short-lived access tokens and rotating, revocable refresh sessions.
- MFA for privileged roles.
- RBAC plus facility-level authorization.
- Strict tenant isolation.
- Rate limiting and brute-force protection.
- Safe CORS, security headers, and upload validation.
- Secrets supplied through deployment configuration.
- Audit events for privileged and high-impact actions.
- Dependency scanning and CI security checks.

## 10. Architecture evolution triggers

Consider extracting a domain into a separate service only when there is measurable need, such as independent scaling, separate availability requirements, distinct team ownership, or a materially different deployment cadence. Until then, preserve module boundaries inside the API.
