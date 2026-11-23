# Repro scripts from the review (committed)

Scripts the review wrote and `BLUEPRINT.md` cites as reproductions, acceptance checks or test templates.
They were copied unchanged from the git-ignored `docs/review/_scratch/` (except paths in usage comments).
All target the **local Docker stack** only (`npm run local:up`; API http://127.0.0.1:8080, app
http://localhost:3000) and create throwaway local accounts.

| Script | What it reproduces | Blueprint |
|---|---|---|
| `make-account.mjs` | A local account (and optionally an org with setup done, the Duplex sample and a plan): `node docs/review/repro/make-account.mjs <email> <15+ char password> [--org "Name" slug] [--plan enterprise\|team\|professional\|free] [--admin]` | B-items for local suites |
| `eng/idor.mjs`, `eng/oracle.mjs` (+ `eng/api.mjs`) | Cross-org access sweep (every foreign id must answer 404) and the 404-message oracle (ENG-014) | K1, A-items on 404 bodies |
| `verify-backend/s02-multipart.mjs` | Browser upload of a > 100 MiB file fails (ENG-002) | A-item for multipart upload |
| `verify-backend/s06-approval.mjs` | Share link of an unreviewed working version with approval on (LEAD-004) | WP exit check |
| `verify-backend/s10-stale-draft.mjs` | A promoted dictionary entry lost when a stale draft is published (LEAD-001) | WP exit check |
| `verify-backend/s11-frozen.mjs` | Projects frozen to old preset versions (LEAD-002) | WP exit check |
| `verify-backend/s15-export-edits.mjs` | Sheet "Excel" exports the last run without edits (CAS-002) | A-item for exports |
| `verify-backend/s16-starred.mjs` | Saving a draft changes which rule set new projects get (LEAD-008) | WP exit check |
| `verify-frontend/strictmode-focus.cjs` | Focus jumps under React StrictMode (UX-002) | C-item test template |
| `ux/crawl.mjs` | Playwright + axe crawl over the main screens | B-item axe sweep |

Paths inside the scripts that write outputs may still point at `docs/review/_scratch/...`; that folder is
git-ignored scratch space, so outputs stay local.
