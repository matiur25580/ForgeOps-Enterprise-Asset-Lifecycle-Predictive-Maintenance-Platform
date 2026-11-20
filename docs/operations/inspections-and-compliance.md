# Inspection and compliance workflows

## Purpose

ForgeOps inspections use reusable, version-snapshotted checklist templates to record repeatable safety, condition, compliance, environmental and quality checks against assets. Completed inspections are immutable historical records; editing a template later does not rewrite prior inspection evidence.

## Checklist templates

Templates are tenant-owned and may be organization-wide or scoped to one facility. Each template has a unique tenant code, category and 1–60 checklist items. An item has a stable key, label, optional guidance and required flag. Only owner, admin and manager roles can create templates.

## Executing an inspection

An authorized owner, admin, manager or technician selects a facility, asset and active template. The API verifies tenant ownership and facility access for all three resources. Every required item must have exactly one response. Responses are `pass`, `fail` or `not_applicable`; failed items require finding notes. The record stores a snapshot of the template title, code, category and item labels so evidence remains interpretable after template changes.

A completed inspection is classified as pass when no failed items exist, otherwise fail. The record stores the performer, execution timestamp, item responses, finding count and asset/facility references.

## Corrective actions

A manager, owner or admin can create a corrective work order from a failed inspection. Failed checklist items and notes are carried into the work-order description. The inspection links to its corrective work order; repeat requests return the existing linked work order instead of creating another. The API also adds a tenant-scoped unique source-inspection index as a duplicate guard.

## API

All routes are under `/api/v1/inspections` and require bearer authentication.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/templates` | List active templates visible to the caller |
| POST | `/templates` | Create a checklist template (owner/admin/manager) |
| GET | `/` | List inspection history with optional facility/result filters |
| POST | `/` | Submit a completed inspection |
| POST | `/:inspectionId/corrective-work-order` | Create/link corrective work order for failed findings |

## Audit and security

Template creation, inspection submission and corrective-work-order linkage create audit events. Tenant ID is derived from the verified access token; facility scope is enforced on each resource. Cross-tenant template, asset and inspection references are not exposed as valid resources.

## Current boundaries

- Templates are manually created; regulatory libraries and jurisdiction-specific rules are not bundled.
- Evidence is currently stored as a bounded text reference, not uploaded files or cryptographic evidence storage.
- Inspection records are completed in one request; draft, offline/mobile execution, reviewer sign-off and recurring inspection scheduling remain future work.
- Corrective action currently creates one work order per failed inspection, not a separate work order per failed checklist item.
- The API records inspection evidence and audit history; it does not certify regulatory compliance or replace a qualified inspector.
