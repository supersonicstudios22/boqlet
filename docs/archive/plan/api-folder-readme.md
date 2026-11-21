# 05-api

> **Archived (history, not current).** The README of the old `plan/05-api/` folder. The contract files are in `packages/api` and `packages/pricing-api` ([../../architecture/contracts.md](../../architecture/contracts.md)).


The contract files moved out of the plan in FE-001; this folder keeps the conventions.

| File | Where it is now |
|---|---|
| `openapi.yaml` (core HTTP contract) | [`packages/api/openapi.yaml`](../../../packages/api/openapi.yaml), client `@ifc-boq/api` |
| `openapi-pricing.yaml` (pricing module, P36) | [`packages/pricing-api/openapi-pricing.yaml`](../../../packages/pricing-api/openapi-pricing.yaml), client `@ifc-boq/pricing-api` |
| `redocly.yaml` (lint rules) | [`packages/api/redocly.yaml`](../../../packages/api/redocly.yaml) |
| `conventions.md` | here |

Wherever the plan says `packages/api/openapi.yaml` or `packages/pricing-api/openapi-pricing.yaml`, read the paths
above. Lint with `npm run api:lint`, regenerate the clients with `npm run api:gen` (both in the
product root).
