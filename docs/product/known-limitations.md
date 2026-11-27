# Known limitations

What the product can't do yet, what is known to be approximate, and what is known to be missing in
the tests. Gaps against the feature specs are listed in each spec's status block
([features/](features/README.md)) and summarised in [overview.md](overview.md#intended-vs-built).
What to do next: [roadmap.md](roadmap.md). What was done: [../changelog.md](../changelog.md).

**Keep this page current** (project rule): when you fix a limitation, delete or shrink its row and
add a line to the changelog with the date and commit. When you notice a new limitation while
working, add it here before you finish, even if nobody asked. Older sections (the proof of
concept's dev build, phase 1 on the mock) are in [../archive/limitations-history.md](../archive/limitations-history.md).

## Engine

| Area | Limitation | Consequence | Where to fix |
|---|---|---|---|
| Worker cancellation | HTTP cancellation is checked between engine stages | A long native geometry call can finish before cancellation is observed | `engine/ifc_boq/worker.py` (EN-009) |
| Validation | Quantities checked only for the Duplex (hand-made BoQ) and the buildingSMART samples; no professional BoQ to compare with; the NBU federations were checked by inspection | Accuracy on real projects unknown: **the biggest open question** | Reference projects with IFC + professional BoQ ([roadmap.md](roadmap.md)) |
| Test coverage | 309 files from 30 tools run without engine errors ([../12-ifc-corpus-catalogue.md](../testing/ifc-corpus-catalogue.md)); missing: IFC4.3 from real tools, Bonsai / FreeCAD, Revit 2022+, Archicad 24+, files over 60 MB, ifcXML. Federation run only on two Revit 2011 architecture + structure pairs; no MEP model federated | Other tools and big files will surface new quirks | Corpus (`npm run corpus`, [../testing/engine-validation.md](../testing/engine-validation.md)) |
| Multi-language names | The seed dictionary resolves English plus a few languages entry by entry. Real projects block on local material names: Dutch (`Kalkzandsteen`, `Staal`, `Metselwerk`, `spaanplaat` in Schependomlaan), Norwegian (`tegl`, `gipsplate` in DURAARK; a few added ad hoc), German (`Leer`) | Most "needs input" results on real files are a name, not an engine problem | Decide a general approach (per-language seed packs, a public term source such as bSDD, or AI suggestions with confirmation; Q8) instead of adding languages one at a time |
| AI name suggestions | Settings exist in the dictionary type (`packages/types/src/dictionary.ts`), nothing implemented | Unknown names always go to a question | `names.py`; per unique name, cached, thresholds from settings |
| Placeholder material names | "Default" (and similar) becomes a blocking name question | Correct but unexplained | A `placeholder_material` parse check, or a dictionary term for "unspecified" with a non-blocking question |
| Infrastructure location | Elements in IfcBridgePart / IfcRoadPart have no storey; lines have no location | Infrastructure BoQs cannot split by part | `storey`-like field for the nearest spatial container |
| Terrain and planting | IfcGeographicElement counted (nr) by as-modelled | Grass, soil, river bed as "1 nr" | Site-works rule set: area / volume by predefined type or material |
| IFC2x3 / IFC4 infrastructure | Exported as proxies and IfcBuilding | Only counted as unknown objects | Dictionary or rules on ObjectType ("sleeper", "rail"); nothing to do in the engine |
| Footing formwork | `vertical_face_area` (A-10) leaves out the faces standing against another footing, wall, slab, column, pile or beam of the same model, whatever its material (the parser does not resolve materials), sampled on a 0.2 m lattice (a contact narrower than that is approximate); a footing against another model's element (federation) is not detected; a parse from before A-10 falls back to 2 x (length + width) x height | Formwork may be slightly short where a footing abuts a non-concrete solid, or slightly long against another model's structure | `geometry.vertical_faces`; contact across models in `federation.py` |
| Wall finishes | Paint to plasterboard (A-11) is measured per face from the face's outermost layer; when a wall's layer-set direction or placement cannot be read and its first and last layers differ, the last layer is put on side a (noted on the element); a finish inside the build-up (a layer that is not outermost) is not a face finish. An element of one material (no layer set) carries it on both faces. As an item, paint does not follow an edited wall line, and the room-faces choice of the old `paint_walls_formula` slot is gone (room finishes are the `room-*` items); a firm's saved patch that set that slot still runs, its value ignored. Reveals (A-12, `finish_add_reveals`) are added at half the opening's depth on each finished face: the frame position is not read, so a frame flush with one face is not modelled; room finishes (`room-walls`, a formula) do not add reveals | Paint may sit on the wrong face of an oddly exported wall (the area differs only where the faces differ) | `measure.face_layers`; a reveal / finish slot per room type |
| Wall area | A wall is measured by its faces (mean of both sides, openings cut) only when its mesh is a closed, clear plate standing up whose oriented box is at most 1.5x its thickness thick (A-09); curved or bent walls, open meshes and walls without measured sides keep net volume / thickness, which understates a body that is not a full prism. Layer volumes (and material groups, A-24) stay layer area x layer thickness, so on a notched wall they add up to more than its volume; beyond 2 % the log says so (`log.quantity.parts_volume`) | Curved walls with a notch or partial body are understated; a layer breakdown in m3 of a notched wall is slightly over its volume | `measure.py` (faces of curved walls by curvature, not by normal); layer volumes as a share of the element's volume |
| Faces and rooms | Built: real wall sides, faces per room from geometric contact (0.1 m), rooms measured with net wall area and skirting, also across federated models (needs the mesh sidecar). Limits: openings shared over a side in proportion, not placed; rooms bounded at wall centre lines by a tool are missed by the 0.1 m tolerance; slab top / bottom keep the main area | | Opening placement on faces; `IfcRelSpaceBoundary` 2nd-level geometry where present |
| Roofs without layers | A roof body without a layer set (A-15) is its faces looking up (normal z > 0.05): an upstand's or parapet's top and any step in the roof count too, and a roof whose parse predates A-15 stays an empty flagged line until the model is uploaded again | Roof area slightly over on roofs with upstands; old parses unchanged | Re-parse on upgrade, or the up faces split by the roof's main planes |
| Slab concrete | In-situ concrete (A-14) is chosen by the layers' dictionary terms: a concrete layer the dictionary does not resolve is not counted (it raises a name question), and a layer named like concrete but resolved otherwise is not either; a multi-layer slab's layers are area x layer thickness, so a thickened edge or a drop panel is missed (a single-layer slab keeps its volume) | Concrete understated where layer names are unknown or the build-up is not prismatic | Layer volumes from the mesh (A-24 owns breakdown volumes) |
| Slab perimeters | `perimeter_openings` (A-13) is each opening's plan box, 2 x (width + height): a round or slanted opening's edge is overstated (a 1 m round hole counts 4 m, not 3.14 m); an opening reaching the slab's outer edge (a notch) is counted as a hole; a reported `Perimeter` is assumed to include the opening edges, so for an exporter that reports the outer edge only, the outer edge is understated by the openings' edges. A firm's saved patch with the old formula `(perimeter + SUM(openings.perimeter)) * thickness` keeps counting the openings twice | Edge formwork off by the difference on slabs with round openings or notches | Opening outline from the mesh (parse), or a per-exporter note in the quantity sources |
| Footprint / developed area | Only where measured; developed falls back to net area | Sloped roofs and stairs approximated | `measure.py` |
| Deductions | `embedded` works (from solid intersections, also across models) but only where parse's overlap check ran (on by default; the corpus runs had it off), only linear elements in planar ones, and columns (IfcColumn only) in rooms. Recesses only when the IFC marks them (RECESS, ObjectType "Recess"); a void shallower than its host is not detected as a recess | A footing through a slab is not "embedded"; unmarked niches count as through-openings | Recess detection from geometry (depth < host thickness, no filling) if exporters do not mark them |
| Building values | `building.*` are derived when the IFC has no `Qto_BuildingBaseQuantities`: gross floor area = floor slab plan areas, gross volume = slab plan area x storey height (no external envelope), footprint = largest storey | Approximate on stepped or sloped buildings | Envelope from the solids, if a rulebook needs exact gross volume |
| Embedded area | Area taken out of a face = shared volume / host thickness, which assumes the element passes through the whole thickness | A downstand beam half inside a slab deducts half its width from the slab face | Per-face intersection (clip the element's section on each face) if a rulebook needs it |
| Plausibility | `implausible` warnings (A-07) cover slabs only (thicker than wide or than 1.5 m, named like piles, pads or caps), floor-slab lines above footprint × storeys and storeys above 3 × the footprint; the name words are a short multilingual list a firm extends in the resolution settings; no "treat as IfcPile / IfcFooting" action (the rule language has no reclassification rule) | A pile cap exported as a slab is still priced as a slab until someone acts on the warning | A reclassification answer (`unmatched`-style) and checks for other classes (walls thicker than long, columns longer than the storey) |
| Decisions on the trace | A line's trace names the contradiction answers and `missing_data` values its elements rest on (A-06); name answers (`unknown_name`, which pick a material or type and so a line) and `unmatched` answers (which force a rule) are counted in `decisionsApplied` but not named per element | A reviewer sees the count, not which name answer moved an element into a line | Name the decision layer's entries per element (`names.py` `decision:` entries) |
| Contradiction thresholds | Asking (10%) and blocking (50%) are resolution settings (`contradictionWarnPct`, `contradictionBlockPct`, D73); the 5 mm thickness floor, the 0.5–2× plausibility band and the 2% unit-error band are constants in `measure.py`. Geometric thickness and area come from clear plates only (volume / mean side area); other shapes are not cross-checked. The pilot's system resolution preset (seeded once by V5) has no explicit thresholds and takes the defaults | Revit stud walls with joins raise several optional questions per project (NBU: 2-7); a difference above 50% now blocks | Review with a QS which differences matter |
| Steel | Nominal kg/m only for metric W shapes parsed from the name | Other sections fall back to volume x density | Bundle a section table (check licence) or read profile area |
| ArchiCAD quantity names | Entries in `quantity_sources.json` are guesses | May miss ArchiCAD quantities | Verify on a real export |
| Questions | `classification_conflict` answers are informative only; contradictions cover volume, thickness and (on clear plates) area, not flags such as IsExternal on a door vs its wall, or materials; overlaps inside one file stay parse checks | | `classify.py`; more contradiction kinds in `measure.py` |
| Overlap check | Between models (federation): a uniform grid over the element boxes finds the pairs whose boxes overlap (review B-24), then a solid boolean per pair. Within one model (`parse.py`, the `intersections` behind `embedded`): still a sweep along x | The in-model check is slow for large or tall models | The same grid in `parse.py` (N-38) |
| Federation | Built (`federation.py`): ownership, scope, same-GlobalId merge (copies that disagree are asked, `duplicate_conflict`, D86; an aggregate's copies compare names only, and lines fed by an open one are not marked to confirm), storeys, overlap questions, aggregates re-summed, fillings / rooms / embedded linked across models. **Shared coordinates assumed** (only a `federation_coordinates` warning when models don't overlap) | Models in different coordinates are not aligned | Alignment step |
| Federation details | A door is matched to another model's opening by boxes (half of the smaller); if the other model's wall has no opening, only a warning (the wall stays uncut, its area not reduced). Ownership defaults are a first guess: on the NBU sets the structure models also hold roofs, stairs, ramps and some slabs the architecture model does not, reported as `federation_hole` warnings | Possible wrong area on uncut walls; ownership warnings a user must read | Review the default ownership table with real project teams |
| Large models | Each job is one synchronous pass; all meshes of every model are held in memory during a federated run; nothing over ~200 MB tried. **A medium model parses in 9 minutes, not 5** (NFR target): the NBU Medical Clinic MEP model (207 MB, 16,012 elements); the geometry kernel alone (ifcopenshell building solids from 4.7 million faceted triangles) takes 7 min on 12 cores, so 5 min cannot be reached without changing the kernel. Left to try: another geometry library or kernel settings; a faster JSON-schema check of the parsed model (about 2 min single-core). **Memory** (review B-22, 2026-11-27): the peak is the geometry kernel's, inside a shape (S07: 1,577 MB with 12 kernel threads, 1,293 MB with 4, 1,196 MB with 2), while the meshes the parser keeps are about 90 MB; streaming them out would not lower it. A parse past `BOQLET_PARSE_MEMORY_MB` now fails as `too_complex` instead of being killed, but a single shape that spikes past the container limit between two checks is still killed. The pilot's worker has two CPUs, so there it takes far longer | Slow first parse of big models | `parse.py`, `geometry.py`; spatial index; load meshes per need |
| Item library / client templates | Item texts on classification codes (P14) and Excel edits import are built; no GAEB, no "import a BoQ as template" | | New input or rule-set extension |
| Export | Excel only | | GAEB, ÖNORM A 2063, CSV, IfcCostSchedule |
| Renovation and design options | Renovation: as-modelled's `renovation_scope` / `measure_demolition` (rule-set `scope`, `scope: "out"` items); status read from Revit phasing or IFC `Status` only, other tools' own phase properties not mapped. Design options: field measured, unused | | Map more phase properties as they are met; design options: presets + selectors |
| Units | Imperial output supported by conversion; no imperial presets or descriptions. Line units come from one registry (D93); a unit outside it (a firm's own label such as "pcs") is refused by the preset check, and the app's own unit tables are not yet read from it (B-15) | | Presets; B-15 |
| Rounding of derived lines | Uses the rule's rounding or the defaults | Fine; noted for QS review | |

## Product (app, Java backend, worker)

**Accounts and billing**
- **Public sign-up has basic bot protection only** (P57): a hidden field, a minimum fill time of
  3 s (measured by the browser, so a script can claim it) and throttling (20 sign-up or reset
  requests per address and 3 per email in 15 minutes). No captcha or proof of work; to upgrade
  before sign-up gets traffic. Sign-up is off until the platform admin opens it (Settings in the
  console). Sign-up asks for no terms or privacy acceptance: there are no such pages yet.
- **Plan prices are shown, not charged** (P57, D7); one currency for every plan. A plan change
  reaches every org on it at once: no plan versions or grandfathering, its history is the audit
  log (`plan.updated` with before and after).
- `ownedOrgsPerUser` (Free: one owned org per person, P57) is checked when an org is created, not
  when ownership passes to someone ("make someone owner"), and an org override can't lift it.
- **Billing is manual**: checkout answers `409 checkout_unavailable`, the billing webhook
  `400 unsupported_provider` (not audited), no provider adapter. A provider waits for paid
  self-service (BE-D7). No trial automation (admins set `trialEndsAt`; nothing drops an org to Free),
  no downgrade handling (excess projects don't become read-only).
- The session takeover question can't say where the other session is: `sessions.place` is never
  written. The 12 h idle expiry is hard-coded (`identity/Sessions.java`), not configurable (F01).

**Landing page** (P58)
- **"Request access" is the sign-up page.** While public sign-up is closed, a visitor reads that
  accounts are by invitation for now and has no way to leave an address: no contact form or
  published contact email yet.
- English only, like the rest of the UI. There is no Open Graph image, favicon or canonical URL
  (`TODO(owner)` in `app/(marketing)/page.tsx`), pending the move from booqlet.com to the product's
  own domain.
- A browser whose session ended while it was closed still carries the signed-in hint, so its next
  visit to `/` opens the sign-in page instead of the landing page. That visit clears the hint.
- The page's facts are copied by hand from the repo: the Duplex line (267.16 m² from 340.575 m²
  less 73.413 m²), its 41 lines and "309 files from 30 authoring tools"
  (`apps/app/messages/en/landing.json`). Change them when the engine or the corpus changes.

**Models, BoQs, sheet, viewer**
- An interrupted upload resumes only in the tab that started it (A-40 keeps the parts sent in
  memory); after a reload the file goes up again as a new version. The app refuses `.ifczip`,
  which Java accepts.
- Scope rules per model / BoQ are shown, not editable. A model can be removed (archived) from its
  page (TF-080), but a model version can't be deleted from the UI (the endpoint exists and answers
  `409 version_in_use` with what uses it, TF-032); no note column.
- No default-preset pickers in project creation or settings (F02).
- A project's unit system (metric/imperial, F02, F15 §7) is stored but has no effect yet: the engine
  outputs metric (EN-imperial, deferred in the test campaign as TF-050).
- No global search (FE-034, TF-016); an earlier run can't be opened read-only (FE-048, F04 §5,
  TF-095): the sheet shows the current run and saved versions.
- The sheet loads every line and groups in the browser up to 20,000 lines; above that it opens
  grouped on the server, read-only (no inline edits, moves, manual lines or the shared 3D filter
  there yet, nor grouping by storey or "measured as" (C-07, N-44); the Changes tab and the Excel edits import still load every line; review B-19, N-40).
  The viewer has no merged-mesh
  picking above 200k elements; "Show in 3D" from a question carries at most 300 GlobalIds; the
  shared filter bar lacks IFC class, type, material and "changed since".
- Library: no manual "rebase on latest" of a "Based on it" clone onto a newer original (its draft is rebased
  when the original is published, TF-140; a draft behind its own preset's newer version is rebased by
  hand, A-43), a dictionary conflict is settled for all conflicting entries at once in the app (the API
  takes a choice per entry), no un-archive (not in the contract), no rename of ids across
  documents, a JSON line diff instead of a structured version diff, no "keep other columns" on
  code-list import.
- A new project takes the org's default presets; pickers come in its settings, not in the creation form
  (review A-44). "Move working BoQs to version n" skips versions in review rather than withdraw them.
- Share links to a version that is not saved, made before approval (or "Share only saved versions")
  was switched on, keep working and can still be edited; nothing revokes them (review A-46, D105).
- Setup wizard is simpler than F16: steps 2 and 3 are the full editors (no "Suggest codes", not
  filtered to names worth asking), no "setup in progress by {name}".
- Audit action names differ from the F09 list (for example `model_version.created`,
  `revision.inputs_updated`, `run.completed`, `line.edited`, `org.setup_done`); no `edits.imported`.

**i18n**
- Engine log entries carry a stable `code` (`log.*`), but the app's catalogue has no `log.*` keys
  yet, so the Log tab shows every entry in the engine's English (questions and warnings render from
  their keys; TF-141). Some warnings (`rule_set`, `federation_hole`), the answer options of engine
  questions and engine line notes are English text without a code
  (`apps/app/src/i18n/engine-message.ts`). This matters once a second language is added (P07).
- The UI ships English and the pseudo-locale only; emails follow the recipient's locale, so English
  while the UI is, with Serbian templates kept for an `sr` UI (`mail/EmailDelivery.java`, DEC-69).

**Security**
- User regexes run on RE2 (D97): ``, `\w` and `\d` know only A-Z and 0-9, so a pattern for a
  word in a non-Latin script uses `\pL`; Latin-script names are also tried without accents and match as
  before. An extractor's or entry's `flags` field is not read (case follows `caseSensitive`).
- The Content-Security-Policy (D101) is report-only in a production build until the pilot has run
  one deploy without `csp.violation` lines and the operator sets `WEB_CSP=enforce`
  (`docs/operations/pilot.md`); styles may be inline (`style-src 'unsafe-inline'`). The `private-headers`
  Traefik middleware the pilot's routes name is defined outside this repo.
- **Accepted for the pilot (P54, Q47; TF-045):** the engine workers hold the same full-bucket storage
  key as the API; the control is the network boundary (internal networks, no host ports) plus, since
  review A-36, the HTTP worker's shared secret (`BOQLET_WORKER_TOKEN`; on the pilot only once the
  operator has set `WORKER_TOKEN`, `docs/operations/pilot.md`). Before a wider rollout: a scoped
  storage identity ([../architecture/security.md](../architecture/security.md)).
- Not built (TF-048): MFA (also for platform admins) and enterprise SSO; an audit row for a failed
  permission check or a failed billing webhook; per-org data export and account deletion with
  "deleted user" audit references. `auth_throttled` (sign-in, set-password) answers without
  `Retry-After`, and the 429 codes differ (`rate_limited` elsewhere) (TF-047).

**Operations** ([../operations/pilot.md](../operations/pilot.md))
- **No staging environment** (P51): the pilot at booqlet.com is the only deployed environment and
  every green push to `main` deploys to it. Staging (BE-032) is a future todo.
- Enrolling the first real owner and email delivery to outside addresses are not qualified yet.
  Alerts are log lines only (no destination); no error tracking (needs an account); no exported
  trace store (needs a collector); `ops/pilot/backup.sh` is written and its restore is tested in
  CI, but it is not installed on the host and has no off-host destination (`BACKUP_REMOTE`).
- Local Windows runs of the native queue worker occasionally hung one parse for minutes (seen once;
  CI on Linux hasn't shown it). Investigate if it recurs.
- **Runs and previews have their own queue worker (`queue-interactive`, TF-180) only once an operator
  rolls out the new `ops/pilot/compose.yaml` on the host** ([../operations/pilot.md](../operations/pilot.md));
  until then a run waits behind a parse on the pilot. Locally the HTTP worker has one process, so a
  run can still wait behind a parse there.
- Usage minutes on the queue transport are the engine's own job time (`durationMs`), not the
  wall-clock of the job's process (its start-up is left out, TF-009); `plans-and-limits.md` says
  "wall-clock".
- There is no demo without a backend: running the app needs Docker ([../development/local-setup.md](../development/local-setup.md)).

**Pricing module** (P48): only `openapi-pricing.yaml` and the core's extension points exist. Its only
backend was a plugin of the removed mock, so it needs its Java part (BE-P1…) before anything of it runs.

## Tests

Details and the outcome coverage map: [../testing/README.md](../testing/README.md).

- **The shared suites on the local Docker stack skip what needs a test clock** (review B-05): `npm run
  local:suites` runs the contract and scenario suites there with native sign-in and SQL in place of the
  harness's test-only routes, but the product image has no `suite_clock`, so the four scenarios that move
  time (session and invitation expiry, the 24 h upload expiry, the clock itself) run only in
  `NativeWorkerTest`. The browser smoke still runs only in the harness.
- **Browser coverage after P53** (TS-005, deferred): the 106 Playwright tests that ran on the mock were
  deleted. The Java browser suite (`apps/app/e2e-java`, 11 specs, 33 tests after the test campaign)
  covers sign-in, accounts and sessions, orgs, FL-1 to the sample BoQ, upload → parse → BoQ → Excel
  → share link (incl. a line's explanation), co-editing, live-update reconnects and edits through an
  API restart, keyboard editing and focus, page titles and small screens, org number formats, the
  limit dialog, a new model version and the change report, and the owner-answer behaviours (B7).
  Since review B-06/B-07 (2026-11-25) it also sweeps 38 screens with axe (serious and critical
  violations beyond `e2e-java/axe-known.json` fail it; one known: the dictionary editor's scroll region,
  C-56), checks 12 core screens in the pseudo-locale `en-XA`, and measures UI budgets nightly
  (`perf.spec.ts`). Since review B-06b (2026-11-27, `areas.spec.ts`) it also covers notifications, the
  viewer with WebGL, two Library editor paths (item-text "Reads as", a slot rename), the admin console
  (overview, an org, a note) and the wizard off its suggested answers. Still not in a browser: the
  Library's dictionary and resolution editors, preview runs from the editors, the admin plan editor
  and overrides, the wizard's items and names steps with real answers.
- Untested in the suites: signed-URL lifetimes,
  `PATCH /manual-items/{id}`, project member GET/PATCH, the billing webhook; two `it.todo` (24 h
  `awaiting_upload` expiry, a successful parse retry). The plan limits, rate limits,
  `invalid_transition`, app security headers, the `.xlsm` refusal and the role matrix are covered
  since the test campaign (`tests/scenarios/limits`, `permissions`, `AccountSecurityTest`,
  `test_xlsx_guard.py`).
- Java's tests are mostly integration tests (`ApiFoundationTest`, `AccountSecurityTest`,
  `NativeAuthTest`, `NativeWorkerTest`, `BackupRestoreTest`, `ErrorResponsesTest`), with a few unit
  tests (`JobDispatcherTest`, `ParseJobErrorsTest`, `RequestSizeFilterTest`, `HealthTimeoutTest`,
  `AlertMonitorTest`) and the ArchUnit `CoreArchitectureTest`.
- The API performance suite runs nightly since review B-09 (`.github/workflows/nightly.yml`, not a deploy
  gate; its budgets are not yet proven on a GitHub runner, TS-006). The 20 k-line lines page
  under 20 clients met p95 ≤ 500 ms at the API (122 ms) but was measured from a client only on a
  laptop through Docker Desktop (679 ms); a check from a Linux client is still to do (TF-179).
- Workbooks are opened in LibreOffice in CI (review B-11: PDF, recalculated totals equal the engine's);
  opening them in Microsoft Excel is still a check by hand (F12-AC1).
- The keyboard pass was done in the test campaign (Stage 4, fixes TF-158…TF-172); a screen-reader
  pass (NVDA) and the 15-minute first-setup test with a new person (v1-12) are still to do by hand.
