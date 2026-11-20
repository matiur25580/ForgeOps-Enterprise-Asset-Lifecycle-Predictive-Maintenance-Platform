# ForgeOps — Enterprise Asset Lifecycle & Predictive Maintenance Platform

> A multi-tenant enterprise platform for managing physical assets, maintenance operations, inspections, spare parts, vendors, and equipment health across multiple facilities.

**Project status:** Phase 2 — Facility & Asset Registry (API implemented; CI verified)  
**Primary stack:** MEAN — MongoDB, Express.js, Angular, Node.js  
**Language:** TypeScript across the application  
**Repository:** [ForgeOps](https://github.com/matiur25580/ForgeOps-Enterprise-Asset-Lifecycle-Predictive-Maintenance-Platform)

---

## 1. Product vision

ForgeOps gives asset-intensive organizations one operational workspace for the full lifecycle of their physical assets. It connects asset records, preventive maintenance, work orders, inspections, inventory, service contracts, sensor telemetry, and operational analytics.

The initial release will use realistic seeded data and simulated IoT telemetry so the product can be demonstrated without requiring factory hardware. Integrations with real devices can be added behind stable ingestion interfaces later.

## 2. Who is it for?

- Manufacturing and industrial operations teams
- Power, utilities, and infrastructure operators
- Hospitals and large facilities teams
- Data centers, airports, and warehouses
- Third-party maintenance and field-service providers

## 3. Core product areas

| Domain | Capabilities |
|---|---|
| Organization & tenancy | Organizations, facilities, departments, tenant isolation, subscription limits |
| Identity & access | Authentication, MFA, roles, permissions, invitations, session management |
| Asset registry | Asset hierarchy, categories, QR/barcode identifiers, warranty, lifecycle, documents |
| Maintenance | Preventive plans, corrective requests, work orders, task checklists, approvals, SLA tracking |
| Inspections & safety | Configurable checklists, scheduled inspections, findings, corrective actions, evidence |
| Inventory & MRO | Parts catalogue, warehouses, stock movements, reservations, reorder thresholds |
| Vendors & contracts | Vendor directory, service contracts, warranties, contract renewals, performance |
| Telemetry & asset health | Simulated/device telemetry, threshold rules, health indicators, alert history |
| Operations analytics | Availability, downtime, MTTR, MTBF, maintenance spend, backlog, facility comparisons |
| Notifications & audit | In-app alerts, email integration, activity history, security and business audit events |
| Reporting | Filterable reports, CSV exports, scheduled report foundation |

## 4. Architecture

The application is a modular monolith initially: one deployable API with clear domain boundaries. This keeps development and deployment manageable while preserving the option to extract high-load domains into services later.

```text
forgeops/
├── apps/
│   ├── web/                 # Angular application
│   └── api/                 # Node.js + Express API
├── packages/
│   └── contracts/           # Shared DTOs, API contracts and enums
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── security/
│   └── product/
├── infrastructure/
│   ├── docker/
│   └── deployment/
├── scripts/
├── .github/workflows/
├── docker-compose.yml
└── README.md
```

### Request and data flow

```text
Angular Web App
      |
      | HTTPS / REST, WebSocket for live updates
      v
Express API (Node.js + TypeScript)
      |
      +-- Authentication & authorization
      +-- Tenant context and policy enforcement
      +-- Domain modules and validation
      +-- Background jobs / notification adapters
      |
      v
MongoDB (Mongoose)
      |
      +-- Tenant-scoped operational data
      +-- Time-series telemetry collections
      +-- Domain audit events
```

### Technology choices

| Layer | Technology |
|---|---|
| Frontend | Angular, TypeScript, Angular Material, RxJS |
| State management | NgRx where shared, workflow-level state justifies it |
| Backend | Node.js, Express.js, TypeScript |
| Database | MongoDB, Mongoose |
| Real-time | Socket.IO |
| API contract | REST, OpenAPI / Swagger |
| Authentication | Short-lived access tokens, rotating refresh tokens (MFA planned) |
| Validation | Shared DTO contracts and server-side schema validation |
| Testing | Node.js test runner, MongoDB integration tests, Angular CLI build (E2E planned) |
| Delivery | Docker, GitHub Actions, environment-based deployment |

## 5. Multi-tenancy and security principles

Security is a core design constraint, not a final polishing task.

- Every tenant-owned record is scoped by a server-derived tenant context.
- The API must enforce tenant boundaries on every read and write; client-side filtering is never an authorization control.
- Role-based access control is combined with resource and facility-level permissions.
- Passwords are stored using a modern password-hashing algorithm.
- Refresh tokens are rotated, revocable, and stored securely.
- MFA is planned for privileged accounts; it is not implemented yet.
- Validate and normalize all untrusted input on the server.
- Apply rate limits, secure headers, safe CORS policy, and request size limits.
- Record security-sensitive and business-critical actions in audit events.
- Never commit secrets; use environment variables and provide only a safe `.env.example`.
- Use least-privilege database and deployment credentials.

## 6. Key operational metrics

- **Availability:** proportion of scheduled time an asset is operational.
- **Downtime:** time an asset is unavailable, with reason and work-order linkage.
- **MTTR:** average time required to restore an asset after failure.
- **MTBF:** average operating time between recorded failures.
- **Maintenance backlog:** approved work not yet completed.
- **Maintenance cost:** labor and parts cost over a selected period.

Metric definitions and calculation windows will be documented so dashboards are consistent and explainable.

## 7. Delivery roadmap

### Phase 0 — Product and engineering foundation
- [x] Create the project repository
- [x] Define product scope and architecture
- [x] Establish monorepo workspace and coding standards
- [x] Add Docker-based local development
- [x] Add CI checks and environment templates

### Phase 1 — Identity and tenant foundation
- [x] Organization onboarding and tenant provisioning
- [ ] User invitations and account lifecycle
- [x] Authentication and refresh-token rotation; MFA remains planned
- [x] Roles, permissions, and facility scopes
- [x] Tenant-isolation integration tests

### Phase 2 — Asset and facility management
- [x] Facility registry and facility-level access scopes; departments remain planned
- [x] Asset registry and lifecycle status
- [ ] Asset documents, warranty, and QR identifiers
- [x] Search, filters, and pagination; import/export remains planned

### Phase 3 — Maintenance execution
- [ ] Maintenance requests and work orders
- [ ] Preventive maintenance schedules
- [ ] Technician assignment and task checklists
- [ ] Approval workflows and SLA tracking
- [ ] Work history and maintenance costs

### Phase 4 — Inventory, vendors, and inspections
- [ ] Parts catalogue and warehouse stock
- [ ] Stock movements and reservations
- [ ] Vendors, contracts, and warranty tracking
- [ ] Inspection templates, findings, and corrective actions

### Phase 5 — Telemetry and operational intelligence
- [ ] Simulated telemetry ingestion
- [ ] Threshold rules and alert lifecycle
- [ ] Asset health indicators and trend charts
- [ ] Facility operations dashboard
- [ ] MTTR, MTBF, downtime, and cost analytics

### Phase 6 — Production readiness
- [ ] End-to-end test coverage for critical workflows
- [ ] Load and performance testing
- [ ] Security review and threat model
- [ ] Observability, backup, and recovery documentation
- [ ] Deployment guide and demo environment

## 8. Local development

The exact commands will be added when the workspace and package scripts are committed. The intended local setup will use:

- Node.js LTS
- npm
- Angular CLI
- Docker Compose
- MongoDB via Docker for local development

Copy `.env.example` to `.env` once it is available. Never place real credentials in source control.

## 9. Engineering quality bar

A feature is not considered complete merely because its screen exists. Each production-oriented workflow should include:

1. A documented user story and acceptance criteria.
2. Server-side validation and authorization.
3. Tenant-isolation coverage where tenant data is involved.
4. Loading, empty, error, and success UI states.
5. Unit or integration tests for critical business rules.
6. Audit events for sensitive state transitions.
7. API and user documentation where appropriate.

## 10. Demo strategy

The demo environment will include clearly identified fictional organizations, facilities, assets, technicians, work orders, and simulated sensor readings. No real customer or industrial telemetry data is required.

Demonstration scenarios will include:
- Register an asset and assign it to a facility.
- Schedule preventive maintenance.
- Raise a fault and create a corrective work order.
- Assign a technician and complete the repair workflow.
- Trigger a simulated sensor threshold alert.
- Reserve a spare part and record stock movement.
- Compare downtime and maintenance KPIs across facilities.

---

## Project principles

**Real workflows over decorative dashboards. Secure defaults over shortcuts. Explainable metrics over invented AI claims. Modular architecture over premature microservices.**

ForgeOps is being developed incrementally. Features listed in the roadmap are planned until their implementation and tests are present in the repository.
