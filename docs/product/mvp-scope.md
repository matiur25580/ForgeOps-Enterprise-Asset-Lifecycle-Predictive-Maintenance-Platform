# ForgeOps MVP Scope

## Goal

Deliver a demonstrable, secure workflow for one organization with multiple facilities, multiple roles, registered assets, planned maintenance, work orders, and operational reporting. The data model and authorization design must support multiple tenants from the beginning.

## MVP personas

- Company administrator
- Operations manager
- Maintenance manager
- Technician
- Inventory manager
- Executive read-only user

## MVP workflows

### A. Organization and access
- An organization is provisioned with at least one facility.
- An administrator invites a user and assigns a role.
- Users can only access organizations and facilities for which they have permission.
- A privileged user can enable MFA.
- Account and session changes are auditable.

### B. Asset lifecycle
- An authorized user creates, views, updates, archives, and searches assets.
- Each asset has a tenant-scoped asset code.
- Assets can be assigned to a facility, department, category, and parent asset.
- Asset detail includes warranty, lifecycle status, documents, and maintenance history.
- QR identifiers resolve only after server-side authorization.

### C. Maintenance execution
- A user submits a maintenance request against an asset.
- An authorized manager reviews and converts it into a work order.
- A manager assigns a technician, priority, due date, and checklist.
- A technician records work performed, parts used, time spent, and evidence.
- A manager reviews and closes the work order.
- Status transitions are validated and audited.

### D. Preventive maintenance
- A manager defines a schedule by calendar interval or usage threshold.
- The scheduler identifies due maintenance and creates or queues work orders idempotently.
- Missed and upcoming maintenance are visible in the dashboard.

### E. Inventory
- An inventory manager creates parts and warehouse locations.
- Stock receipts and issues create traceable stock movements.
- Parts can be reserved for a work order.
- Reorder thresholds generate low-stock alerts.

### F. Operational dashboard
- Users see metrics permitted by their role and facility scope.
- Dashboard metrics are calculated from persisted operational records.
- Date range and facility filters are supported.
- Empty states are explicit; demo data is identified as synthetic.

## MVP non-goals

- Direct control of industrial machinery.
- Safety-critical autonomous decisions.
- Certified regulatory compliance claims.
- Production-grade machine-learning failure prediction without validated datasets.
- Native iOS/Android apps; the technician experience is responsive web.
- Microservices before scaling evidence exists.

## Acceptance criteria

A workflow is complete only when:
1. Its API validates input and enforces authorization.
2. Tenant and facility boundaries are tested.
3. Critical state transitions are covered by automated tests.
4. The UI supports loading, empty, error, and success states.
5. High-impact actions produce audit events.
6. API behavior is documented.
7. A realistic demo scenario can be completed end-to-end.

## Demo scenario

1. Sign in as a company administrator.
2. Create two facilities and invite a maintenance manager and technician.
3. Register an industrial pump in Facility A.
4. Configure a monthly preventive maintenance plan.
5. Submit a fault request and approve a corrective work order.
6. Assign the work order to the technician.
7. Reserve a replacement part, complete the checklist, and submit repair notes.
8. Approve and close the work order.
9. Review asset history, downtime, maintenance cost, and facility dashboard.
10. Attempt to access the same asset from a different tenant and verify access is denied.
