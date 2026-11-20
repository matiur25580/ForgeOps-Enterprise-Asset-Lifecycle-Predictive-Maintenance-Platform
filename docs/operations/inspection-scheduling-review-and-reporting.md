# Inspection scheduling, independent review and compliance reporting

## Recurring schedules

Managers, admins and owners can define a facility/asset/template schedule with an interval (1–3650 days), next due date, priority and optional assignee. The API verifies that the facility, asset and active checklist belong to the tenant and that the asset belongs to the selected facility.

Schedules can be paused or resumed. An active schedule can generate an inspection-type work order once its due date is reached. Generation records the scheduled due timestamp on the work order, advances the schedule by the configured interval, and relies on a tenant-scoped unique index across schedule and scheduled date to prevent duplicate records for the same cycle. Early generation is rejected with `INSPECTION_NOT_DUE_YET`.

Endpoints:
- `GET /api/v1/inspections/schedules`
- `POST /api/v1/inspections/schedules`
- `PATCH /api/v1/inspections/schedules/:scheduleId/status`
- `POST /api/v1/inspections/schedules/:scheduleId/generate-work-order`

## Independent inspection review

Submitted inspections begin in `pending` review state. Owner/admin/manager reviewers can approve or reject an inspection. A performer cannot review their own inspection. Rejection requires review notes. The review decision, reviewer and timestamp are stored on the inspection and recorded in the audit log. Review is a workflow control, not a legal certification.

Endpoint: `PATCH /api/v1/inspections/:inspectionId/review` with `{ decision: 'approved' | 'rejected', notes?: string }`.

## Compliance reporting

`GET /api/v1/inspections/reports/summary` returns aggregate inspection counts, pass/fail totals, findings, pass rate and category breakdown. Optional ISO date query parameters `from` and `to` filter the performed-at period. Reports are tenant and facility scoped.

## Security and limitations

All operations require authentication. Schedule creation, generation, review and report queries enforce tenant ownership and facility access. Schedule generation creates work orders; it does not itself perform an inspection or mark compliance as complete. A technician must execute the checklist and submit the inspection record. Calendar notifications, automatic background dispatch, regulatory framework packs, digital signatures and evidence-file storage remain future work.
