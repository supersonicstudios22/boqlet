# Non-functional requirements (v1 targets)

Measured on staging with the reference files (fixtures and corpus, docs/12). Size classes as
in docs/10. Under P51 the measurements of TS-002 (2026-11-21) ran on the local native stack (Java,
Postgres, MinIO and the worker through Testcontainers; the app as a production build against the
mock and the engine worker) on the owner's Windows machine, never on the pilot, whose worker has two
CPUs: engine times there are longer. How to repeat them: `08-delivery/testing.md` "Performance".

## Model processing

| Model | Example | Parse (first upload) | Run (cached parse) | Measured (TS-002, 2026-11-21) |
|---|---|---|---|---|
| Small: < 1k elements, < 20 MB | Duplex (2.4 MB, 218 elements) | ≤ 30 s | ≤ 5 s | parse 3.3 s, run 0.6 s ✓ |
| Medium: 10k–50k elements, 50–300 MB | NBU office pair, corpus medium files | ≤ 5 min | ≤ 60 s | NBU Medical Clinic MEP (207 MB, 16,012 elements): **parse 9.0 min ✗** (11.0 before TS-002's mesh repair fix), run 21 s ✓ |
| Large: 200k+ elements, > 300 MB | Enterprise only | ≤ 30 min (large pool) | ≤ 5 min | not measured (no such model in the corpus) |
| Federated medium pair | NBU Medical Clinic (18 + 19 MB): ~2.5 min today | ≤ 3 min both parses in parallel | ≤ 60 s | parse 48 s in parallel, run 23 s ✓ |

- Max upload size: per plan, absolute v1 cap 1 GB per version.
- Queue wait (p95) for interactive runs: ≤ 10 s on the standard pool at expected load.
- Engine memory: a medium run fits in 16 GB (meshes of all models are held during
  federation, docs/11). Large runs go to the large pool.

## API and UI

| Item | Target | Measured (TS-002, 2026-11-21) |
|---|---|---|
| CRUD API latency | p95 ≤ 300 ms | Java p95 30–159 ms (GET me, projects, project, BoQ; PATCH project) ✓ |
| Lines page (500 lines) | p95 ≤ 500 ms | Java p95 304 ms ✓ |
| Run ingestion (50k lines) | ≤ 10 s | Java 3.4 s ✓ |
| First contentful paint (app shell, warm) | ≤ 1.5 s | 428 ms (worst of 5) ✓ |
| BoQ sheet: 20k lines | smooth scroll (virtualised); group switch ≤ 300 ms client-side | 60 fps, p95 frame 16.7 ms; switch 52 ms ✓ |
| Viewer: Duplex interactive | ≤ 3 s warm | 460–630 ms ✓ |
| Viewer: 50k elements | ≤ 15 s to interactive; picking ≤ 100 ms | **15.9 s ✗** for the 16,012-element MEP model (59 MB GLB, cold; no 50k model in the corpus); picking 6–7 ms (Duplex) ✓ |
| Live update latency (job finished → UI) | ≤ 2 s | 49 ms, event to refetched data (mock) ✓ |
| (Pricing module) vendor request page load (500 lines) | ≤ 2 s | module not built (P48) |
| Live edit visible to other users of the BoQ (P31) | ≤ 1 s | asserted ≤ 1 s by `e2e/co-editing.spec.ts` F06-AC10 ✓ |

## Capacity (v1 planning numbers)

- 200 orgs, 2,000 users, 5,000 vendors (pricing module).
- 50 concurrent active users, 10 concurrent parse jobs, 30 runs/min peak.
- Storage: ~5 GB per active project per year (versions + artifacts + results).

## Availability and recovery

- 99.5% monthly for web + API (business hours matter most; maintenance windows announced).
- Jobs survive worker crashes (heartbeat re-queue). No job is lost on deploy.
- RPO 1 h, RTO 4 h.

## Browser support

Latest two versions of Chrome, Edge, Firefox, Safari. Desktop first (≥ 1280 px). Read-only
views (saved BoQ version, share page, vendor request page) usable at ≥ 768 px. Vendor pricing works at ≥ 1024 px. WebGL2
required for the viewer (fallback message otherwise).

## Accessibility

WCAG 2.2 AA for the app shell, forms, sheet, share page and vendor pages: keyboard reachable, visible
focus, labels, contrast, no colour-only signals (flags in comparison and coverage use icons or
patterns as well). The 3D viewer is exempt but has keyboard shortcuts and a non-3D element list.

## Quality gates

- Duplex acceptance test green in the engine and through the full stack (v1 criterion 1).
- Contract tests: mock and Java pass the same OpenAPI-based suite (08-delivery/testing.md).
- No `serious`/`critical` axe violations on the main screens.
