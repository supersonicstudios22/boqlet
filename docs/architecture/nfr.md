# Non-functional requirements (v1 targets)

Targets are for the reference files (fixtures and corpus, docs/testing/ifc-corpus-catalogue.md). Size
classes as in docs/archive/platform-design-2026-10.md. There is no staging environment (P51):
the measurements of TS-002 (2026-11-21) ran on the owner's Windows machine, never on the pilot,
whose worker has two CPUs (engine times there are longer). API figures came from Java with
Postgres, SeaweedFS and the real worker through Testcontainers (`NativeWorkerTest`); UI figures
came from a production build of the app against the mock API of that time. The mock and its UI
performance specs were removed (P53), so the UI rows below can't be re-measured until those specs
are ported to the Java browser suite. How to repeat the rest: `docs/testing/README.md` "Performance".

## Model processing

| Model | Example | Parse (first upload) | Run (cached parse) | Measured (TS-002, 2026-11-21) |
|---|---|---|---|---|
| Small: < 1k elements, < 20 MB | Duplex (2.4 MB, 218 elements) | ≤ 30 s | ≤ 5 s | parse 3.3 s, run 0.6 s ✓ |
| Medium: 10k–50k elements, 50–300 MB | corpus medium files (NBU Medical Clinic MEP) | ≤ 5 min | ≤ 60 s | NBU Medical Clinic MEP (207 MB, 16,012 elements): **parse 9.0 min ✗** (11.0 before TS-002's mesh repair fix; the geometry kernel alone takes 7 min here), run 21 s ✓ |
| Large: 200k+ elements, > 300 MB | Enterprise only | ≤ 30 min (large pool) | ≤ 5 min | not measured (no such model in the corpus) |
| Federated pair (the reference pair: NBU Medical Clinic architecture + structure, 18 + 19 MB; the NBU office pair, 15 MB and 1,303 elements, is a small pair and not comparable) | ~2.5 min before TS-002 | ≤ 3 min both parses in parallel | ≤ 60 s | parse 48 s in parallel, run 23 s ✓ |

- Max upload size: per plan, absolute v1 cap 1 GB per version.
- Queue wait (p95) for interactive runs: ≤ 10 s on the standard pool at expected load.
- Engine memory: a medium run fits in 16 GB (meshes of all models are held during
  federation, docs/product/known-limitations.md). Large runs go to the large pool.

## API and UI

| Item | Target | Measured (TS-002, 2026-11-21) |
|---|---|---|
| CRUD API latency | p95 ≤ 300 ms | Java p95 30–159 ms (GET me, projects, project, BoQ; PATCH project) ✓ |
| Lines page (500 lines) | p95 ≤ 500 ms | Java p95 304 ms ✓ |
| Run ingestion (50k lines) | ≤ 10 s | Java 3.4 s ✓ |
| First contentful paint (app shell, warm) | ≤ 1.5 s | 428 ms (worst of 5) ✓ |
| BoQ sheet: 20k lines | smooth scroll (virtualised); group switch ≤ 300 ms client-side | 60 fps, p95 frame 16.7 ms; switch 52 ms ✓ |
| Viewer: Duplex interactive | ≤ 3 s warm | 460–630 ms ✓ |
| Viewer: 50k elements | ≤ 15 s to interactive; picking ≤ 100 ms | 4.3–4.9 s cold for the 16,012-element MEP model (59 MB GLB; 15.9 s before outlines were built after the first frame); picking 30 ms there, 6–10 ms on the Duplex ✓ (no 50k model in the corpus) |
| BoQ sheet, 4,000 lines (review B-07, nightly `e2e-java/perf.spec.ts`, production build, median of 3) | target: first row ≤ 2 s, no task > 100 ms while typing in search (B-18/B-19); gated today at 4 s and 250 ms (regression gates above today's spread, DEC-114) | 2026-11-25, owner's Windows machine, three runs: first row 2.18 / 2.18 / 2.79 s; longest task while typing 99 / 93 / 137 ms |
| Change report, uncached Duplex v1 → v2 (F08-AC4; nightly, median of 3) | ≤ 3 s | 2026-11-25: 590 ms ✓ (the deploy-gate scenario no longer times it: a loaded 2-CPU runner measured 4.9–5.3 s, DEC-07) |
| Live update latency (job finished → UI) | ≤ 2 s | 49 ms, event to refetched data (measured on the mock, removed by P53) ✓ |
| (Pricing module) vendor request page load (500 lines) | ≤ 2 s | module not built (P48) |
| Live edit visible to other users of the BoQ (P31) | ≤ 1 s | asserted ≤ 1 s by the mock-era `e2e/co-editing.spec.ts` F06-AC10 ✓ (deleted in P53; `apps/app/e2e-java/live.spec.ts` checks co-editing on Java) |

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
- Contract and scenario suites green against Java (`NativeWorkerTest`, CI's `api` job;
  docs/testing/README.md). Java is the only implementation since P53.
- No `serious`/`critical` axe violations on the main screens: `apps/app/e2e-java/sweep.spec.ts` (review
  B-06) sweeps 38 screens (WCAG 2.0–2.2 A/AA tags) in the deploy smoke; a violation not in
  `e2e-java/axe-known.json` fails it (one known on 2026-11-25: `scrollable-region-focusable` in the
  dictionary editor, C-56). The same spec checks the pseudo-locale `en-XA` on 12 core screens: no message
  key shown, no missing message, no horizontal overflow at 1440 px.
