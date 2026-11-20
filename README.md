<div align="center">

# ForgeOps
### Enterprise Asset Lifecycle & Operations Intelligence Platform

**One operational workspace for the assets, people, maintenance and decisions that keep critical facilities running.**

[![CI](https://github.com/matiur25580/ForgeOps-Enterprise-Asset-Lifecycle-Predictive-Maintenance-Platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/matiur25580/ForgeOps-Enterprise-Asset-Lifecycle-Predictive-Maintenance-Platform/actions/workflows/ci.yml)
![MEAN Stack](https://img.shields.io/badge/Stack-MEAN-147D64)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6)
![License](https://img.shields.io/badge/License-Not%20specified-lightgrey)

[Product tour](#dashboard-gallery) · [Architecture](#architecture) · [Run locally](#run-locally) · [Engineering notes](#engineering-principles)

</div>

---

## The product

ForgeOps is a multi-tenant asset lifecycle and industrial operations platform for organizations that depend on reliable physical infrastructure: manufacturers, utilities, hospitals, data centres, airports, warehouses and facilities operators.

It connects the operational lifecycle in one place:

**Register an asset → plan maintenance → execute work → manage parts → inspect and verify → monitor equipment health → measure availability and cost → act on operational risk.**

The platform is being built as a realistic enterprise product, not a collection of disconnected CRUD screens. Workflows are tenant-scoped, important state transitions are auditable, and operational metrics document their assumptions.

> **Project status:** Phase 17 — notification preferences, optional SMTP delivery and delivery audit history. The repository is an actively developed portfolio project; see the capability boundaries below for what is implemented versus planned.

## At a glance

| | |
|---|---|
| **Frontend** | Angular standalone components, TypeScript, RxJS |
| **Backend** | Node.js 22+, Express 5, TypeScript |
| **Database** | MongoDB 8, Mongoose |
| **Architecture** | Modular monolith + independently run background worker |
| **Authentication** | Short-lived JWT access tokens, rotating HTTP-only refresh sessions |
| **Validation** | Zod request validation and Mongoose schema constraints |
| **Testing** | Node.js test runner, MongoDB Memory Server integration tests |
| **Automation** | GitHub Actions CI, MongoDB-backed durable job queue |
| **Email** | Optional SMTP delivery through Nodemailer |

## What is implemented

### Asset and facility operations
- Organization onboarding and tenant-scoped identity.
- Facility registry and facility-scoped access context.
- Asset registration, search, filtering, lifecycle changes and soft archival.
- Work-order lifecycle, technician assignment and preventive maintenance plans.
- Downtime reporting, resolution and independent verification.

### Maintenance, inventory and procurement
- Work orders with enforced status transitions and maintenance cost capture.
- Preventive maintenance plans and due work-order generation.
- Spare-parts catalogue, vendors, facility stock balances and stock movement ledger.
- Purchase requisitions, approvals, purchase orders and goods receipt notes.
- Atomic stock guards and duplicate movement protections.

### Inspections, telemetry and asset health
- Reusable safety, condition and compliance checklist templates.
- Facility/asset inspection execution, required-item validation and findings.
- Recurring inspection schedules, manager review and compliance summaries.
- Simulated sensor readings and configurable telemetry threshold alerts.
- Explainable heuristic health indicators and corrective-work-order linkage.

### Analytics and financial intelligence
- Verified schedule-weighted asset availability.
- Planned versus unplanned downtime.
- Work-order-derived MTTR/MTBF proxies, clearly labelled as proxies.
- Maintenance spend grouped by currency; no unsupported FX conversion.
- Straight-line depreciation, warranty exposure and lifecycle TCO.
- Vendor scorecards, procurement commitments and scoped CSV exports.

### Notifications and background processing
- Personal in-app notification inbox with read/unread controls.
- Five-minute scheduled tenant operations scans for due work, contract renewals and critical asset alerts.
- Durable MongoDB job queue with atomic claims, expiring leases, bounded retries and backoff.
- User-controlled email opt-in, per-category preferences and timezone-aware quiet hours.
- Optional SMTP email delivery and a tenant/user-scoped delivery audit ledger.
- Graceful worker shutdown and old job-record retention cleanup.

## Dashboard gallery

The following twelve dashboard illustrations show the intended ForgeOps enterprise experience across its operational domains. Each view is a **UI concept preview with fictional, illustrative data**; it is not a screenshot of a live customer deployment, and figures shown are not production measurements.

### 01 · Executive operations overview
A leadership snapshot of asset availability, open work, at-risk equipment and the latest operational activity.

![ForgeOps executive operations overview dashboard](docs/images/dashboards/01-executive-overview.svg)

### 02 · Enterprise asset registry
A searchable asset portfolio with lifecycle state, criticality, warranty exposure and facility context.

![ForgeOps asset registry dashboard](docs/images/dashboards/02-asset-registry.svg)

### 03 · Maintenance command centre
A maintenance execution view for work-order ownership, priority, overdue workload and preventive maintenance compliance.

![ForgeOps maintenance command centre dashboard](docs/images/dashboards/03-maintenance-command.svg)

### 04 · Facility operations portfolio
A multi-site comparison of facility readiness, availability, scheduled operating hours and unresolved work.

![ForgeOps facility operations dashboard](docs/images/dashboards/04-facility-operations.svg)

### 05 · Spare parts and MRO inventory
A stock-control workspace for part availability, low-stock exposure and traceable inventory movements.

![ForgeOps inventory and MRO dashboard](docs/images/dashboards/05-inventory-mro.svg)

### 06 · Procurement and vendor intelligence
A supplier and procurement view spanning requisitions, purchase orders, delivery performance and contract renewals.

![ForgeOps procurement and vendor dashboard](docs/images/dashboards/06-procurement-vendors.svg)

### 07 · Telemetry and asset health
An equipment-health view using simulated telemetry, configurable thresholds and transparent heuristic indicators.

![ForgeOps telemetry and asset health dashboard](docs/images/dashboards/07-telemetry-health.svg)

### 08 · Alert response and escalation
A prioritised alert console for acknowledgement, ownership, resolution and corrective work-order follow-through.

![ForgeOps alert response dashboard](docs/images/dashboards/08-alert-response.svg)

### 09 · Inspections and compliance
A compliance workspace for recurring inspections, checklist outcomes, findings and independent manager review.

![ForgeOps inspections and compliance dashboard](docs/images/dashboards/09-inspections-compliance.svg)

### 10 · Verified downtime and availability
An availability view grounded in verified downtime events and each asset's configured operating schedule.

![ForgeOps downtime and availability dashboard](docs/images/dashboards/10-downtime-availability.svg)

### 11 · Asset financial intelligence
A lifecycle finance view covering straight-line book depreciation, warranty exposure and currency-aware total cost of ownership.

![ForgeOps asset financial intelligence dashboard](docs/images/dashboards/11-financial-intelligence.svg)

### 12 · Notifications and reporting workspace
A user-focused operations inbox with delivery preferences, email audit status and export-ready reporting.

![ForgeOps notifications and reporting dashboard](docs/images/dashboards/12-notifications-reporting.svg)

## Architecture

ForgeOps uses a **modular monolith** for the HTTP API, with a separately deployable background worker. This keeps domain boundaries explicit without introducing premature microservice complexity.

```text
Angular Web Application
        |
        | HTTPS / REST
        v
Express 5 API  --------------------+
        |                          |
        +-- Authentication / RBAC  |
        +-- Tenant & facility scope |
        +-- Asset / maintenance    |
        +-- Inventory / procurement|
        +-- Inspections / telemetry|
        +-- Analytics / reporting  |
        +-- Notification settings  |
        |                          |
        v                          v
     MongoDB <-------------- Background Worker
        |                    - scheduled scans
        +-- Operational data - email delivery
        +-- Telemetry        - retry / backoff
        +-- Audit records    - lease recovery
        +-- Durable jobs
```

### Repository layout

```text
apps/
  api/
    src/
      auth/             # Access and refresh token services
      config/           # Validated environment configuration
      middleware/       # Authentication, authorization, tenant scope
      models/           # Mongoose domain models
      routes/            # Versioned REST endpoints
      services/          # Domain workflows and delivery adapters
      workers/           # Long-running background worker
    test/                # API and MongoDB integration tests
  web/
    src/app/
      core/              # API client and route guards
      pages/             # Operations workspaces
docs/
  analytics/
  architecture/
  development/
  finance/
  operations/
  reporting/
  security/
  images/dashboards/     # Twelve README dashboard illustrations
.github/workflows/
  ci.yml
docker-compose.yml
.env.example
README.md
```

## Security and reliability

- Tenant identity is derived from verified access-token claims, not trusted request-body values.
- Tenant/user scope is applied on notification, delivery and operational data access.
- Passwords use bcrypt hashing; refresh tokens are rotated, hashed at rest and revocable.
- Role-based access and facility scoping protect privileged workflows.
- Critical state changes have audit-event coverage.
- API input is validated; HTTP security headers, CORS controls and rate limiting are enabled.
- Queue jobs use atomic claims, lease expiry and bounded retries.
- SMTP secrets are environment-only; email is disabled by default for each user.
- Delivery history is user-scoped; notification content is escaped before HTML email rendering.

## Run locally

### Prerequisites
- Node.js 22 or newer
- npm 10 or newer
- Docker Engine/Desktop with Docker Compose

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Set a unique `AUTH_ACCESS_TOKEN_SECRET` of at least 32 characters in `.env`. The example secret is only a placeholder.

### 2. Start MongoDB

```bash
docker compose up -d mongodb
```

The Compose service exposes MongoDB at `mongodb://localhost:27017/forgeops`.

### 3. Start the API and Angular app

In separate terminals from the repository root:

```bash
npm run dev:api
npm run dev:web
```

- API: `http://localhost:4000`
- Web app: `http://localhost:4200`
- Sign in or create an organization at `http://localhost:4200/login`.

### 4. Start the background worker

In a third terminal:

```bash
npm run dev:worker
```

The API and worker must use the same MongoDB database and environment secrets.

### 5. Optional SMTP email

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` in the API and worker environments. Users must separately enable email in **Notification preferences**. Without SMTP, notifications continue in-app and email attempts are recorded as skipped.

See [local development setup](docs/development/getting-started.md) and [email delivery configuration](docs/operations/notification-preferences-email-delivery.md).

## Quality checks

Run from the repository root:

```bash
npm test
npm run typecheck
npm run build
```

CI runs dependency installation, API tests (including MongoDB integration tests), TypeScript/Angular validation and workspace builds on pushes and pull requests.

## Important engineering boundaries

ForgeOps deliberately distinguishes implemented functionality from future integrations:

- **Predictive maintenance:** current asset-health scoring is a transparent threshold heuristic over simulated telemetry. It is not a trained predictive ML model and does not claim validated failure forecasts.
- **Telemetry:** simulated sensor data is available; production industrial protocol/device ingestion is not yet included.
- **Availability:** calculated from independently verified downtime and configured weekly operating hours. Assets without a valid operating schedule are excluded from the measured denominator.
- **MTTR / MTBF:** work-order-derived proxies, not a complete reliability-engineering model based on validated failure/repair event capture.
- **Cost accounting:** costs are grouped by currency; no FX conversion or cross-currency grand total is fabricated.
- **Procurement:** workflow and stock controls are implemented; strict cross-document crash atomicity requires MongoDB replica-set transactions.
- **Email:** optional SMTP transport is implemented. SMS, push, provider webhooks and deferred quiet-hour delivery are not included.
- **Dashboard gallery:** illustrative design assets; live values must be read from the connected application and its APIs.

## Roadmap

- [x] Multi-tenant authentication, rotating refresh sessions and RBAC.
- [x] Asset registry, facilities, maintenance and preventive plans.
- [x] Inventory, vendors, procurement and goods receipts.
- [x] Telemetry simulation, alert lifecycle and corrective work-order links.
- [x] Inspections, recurring schedules, independent review and compliance reporting.
- [x] Verified downtime, availability, asset financials and vendor intelligence.
- [x] Scoped reporting and CSV exports.
- [x] Durable background jobs, scheduled operational scans and retry handling.
- [x] Notification preferences, optional SMTP delivery and delivery audit history.
- [ ] Production device ingestion and validated predictive models.
- [ ] End-to-end browser tests, load testing and independent security review.
- [ ] Email digest scheduling, SMS/push adapters and deferred quiet-hours delivery.
- [ ] Production observability, backup/restore drills and public demo environment.

## Documentation

- [System architecture](docs/architecture/system-design.md)
- [MVP scope](docs/product/mvp-scope.md)
- [Getting started](docs/development/getting-started.md)
- [Authentication and session security](docs/security/authentication.md)
- [Maintenance workflows](docs/operations/maintenance-workflows.md)
- [Inventory and procurement](docs/operations/inventory-and-procurement.md)
- [Procurement and goods receipts](docs/operations/procurement-and-goods-receipts.md)
- [Telemetry and asset health](docs/operations/telemetry-and-asset-health.md)
- [Alert response](docs/operations/telemetry-alerts-and-response.md)
- [Inspections and compliance](docs/operations/inspections-and-compliance.md)
- [Inspection scheduling and review](docs/operations/inspection-scheduling-review-and-reporting.md)
- [Downtime and operations analytics](docs/analytics/operations-analytics.md)
- [Asset financial intelligence](docs/finance/asset-financial-intelligence.md)
- [Reporting and exports](docs/reporting/report-centre-and-exports.md)
- [Background job engine](docs/operations/background-job-engine-and-escalation.md)
- [Notification centre](docs/operations/notification-centre-and-workflow-alerts.md)
- [Notification preferences and SMTP](docs/operations/notification-preferences-email-delivery.md)

## Project principles

**Operational truth over decorative metrics. Secure defaults over shortcuts. Explainable intelligence over black-box claims. Durable workflows over fragile request handlers.**

ForgeOps is an evolving engineering portfolio project. Feature status is documented honestly, and illustrative demo content is clearly distinguished from live operational data.
