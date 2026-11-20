# Telemetry ingestion and asset health

## Endpoints

All routes require a bearer access token and enforce tenant scope from verified claims.

- `POST /api/v1/telemetry/simulate` — owner/admin/manager only. Body: `{ "assetId": "<id>", "samples": 24 }`; samples range from 6 to 48. Creates four readings per sample for temperature, vibration, pressure and current.
- `GET /api/v1/telemetry/readings?assetId=<id>` — returns up to 500 newest readings for an accessible asset, or accessible facilities.
- `GET /api/v1/telemetry/health?facilityId=<id>` — latest reading per metric and explainable health assessment for each accessible, non-archived asset.

## Heuristic health score

Each metric is evaluated against fixed thresholds:
- Temperature: warning at 75°C; critical at 90°C.
- Vibration: warning at 4.5 mm/s; critical at 7.1 mm/s.
- Pressure: warning at or below 2 bar; critical at or below 1 bar.
- Current: warning at 80 A; critical at 100 A.

A warning factor deducts 15 points; a critical factor deducts 35. High-criticality assets receive a 2-point weighting and critical assets 5 points. Score is clamped to 0–100. Bands: healthy (85+), watch (65–84), at risk (40–64), critical (below 40).

This is a deterministic demonstration heuristic, not a trained predictive model, failure probability, or remaining-useful-life estimate. Thresholds are generic and must be calibrated by equipment class and manufacturer guidance before operational use.

## Data and safety boundaries

Telemetry readings are tenant/facility scoped, timestamped and indexed by asset, metric and time. Simulator values are synthetic and tagged with source `simulator`; no physical device integration is implied. The API does not currently implement alert acknowledgement, notification delivery, retention policies, streaming ingestion, or anomaly detection. Simulator randomness is for UI demonstration only.