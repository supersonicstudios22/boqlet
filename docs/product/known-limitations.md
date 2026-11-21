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
| Faces and rooms | Built: real wall sides, faces per room from geometric contact (0.1 m), rooms measured with net wall area and skirting, also across federated models (needs the mesh sidecar). Limits: openings shared over a side in proportion, not placed; rooms bounded at wall centre lines by a tool are missed by the 0.1 m tolerance; slab top / bottom keep the main area | | Opening placement on faces; `IfcRelSpaceBoundary` 2nd-level geometry where present |
| Footprint / developed area | Only where measured; developed falls back to net area | Sloped roofs and stairs approximated | `measure.py` |
| Deductions | `embedded` works (from solid intersections, also across models) but only where parse's overlap check ran (on by default; the corpus runs had it off), only linear elements in planar ones, and columns (IfcColumn only) in rooms. Recesses only when the IFC marks them (RECESS, ObjectType "Recess"); a void shallower than its host is not detected as a recess | A footing through a slab is not "embedded"; unmarked niches count as through-openings | Recess detection from geometry (depth < host thickness, no filling) if exporters do not mark them |
| Building values | `building.*` are derived when the IFC has no `Qto_BuildingBaseQuantities`: gross floor area = floor slab plan areas, gross volume = slab plan area x storey height (no external envelope), footprint = largest storey | Approximate on stepped or sloped buildings | Envelope from the solids, if a rulebook needs exact gross volume |
| Embedded area | Area taken out of a face = shared volume / host thickness, which assumes the element passes through the whole thickness | A downstand beam half inside a slab deducts half its width from the slab face | Per-face intersection (clip the element's section on each face) if a rulebook needs it |
| Contradiction thresholds | 10% and 5 mm are constants in `measure.py` (`CONTRADICTION`, `THICKNESS_MIN`), not settings; geometric thickness = volume / mean side area, asked only for clear plates | Revit stud walls with joins raise several optional questions per project (NBU: 2-7) | Move to a setting if users find them noisy; review with a QS which differences matter |
| Steel | Nominal kg/m only for metric W shapes parsed from the name | Other sections fall back to volume x density | Bundle a section table (check licence) or read profile area |
| ArchiCAD quantity names | Entries in `quantity_sources.json` are guesses | May miss ArchiCAD quantities | Verify on a real export |
| Questions | `classification_conflict` answers are informative only; contradictions cover volume and thickness (not areas, flags such as IsExternal on a door vs its wall, or materials); overlaps inside one file stay parse checks | | `classify.py`; more contradiction kinds in `measure.py` |
| Overlap check | Sweep along x, then a solid boolean per pair whose boxes overlap | Slow for large or tall models | Spatial index (R-tree / BVH) |
| Federation | Built (`federation.py`): ownership, scope, same-GlobalId merge, storeys, overlap questions, aggregates re-summed, fillings / rooms / embedded linked across models. **Shared coordinates assumed** (only a `federation_coordinates` warning when models don't overlap) | Models in different coordinates are not aligned | Alignment step |
| Federation details | A door is matched to another model's opening by boxes (half of the smaller); if the other model's wall has no opening, only a warning (the wall stays uncut, its area not reduced). Ownership defaults are a first guess: on the NBU sets the structure models also hold roofs, stairs, ramps and some slabs the architecture model does not, reported as `federation_hole` warnings | Possible wrong area on uncut walls; ownership warnings a user must read | Review the default ownership table with real project teams |
| Large models | Each job is one synchronous pass; all meshes of every model are held in memory during a federated run; nothing over ~200 MB tried. **A medium model parses in 9 minutes, not 5** (NFR target): the NBU Medical Clinic MEP model (207 MB, 16,012 elements); the geometry kernel alone (ifcopenshell building solids from 4.7 million faceted triangles) takes 7 min on 12 cores, so 5 min cannot be reached without changing the kernel. Left to try: another geometry library or kernel settings; a faster JSON-schema check of the parsed model (about 2 min single-core). The pilot's worker has two CPUs, so there it takes far longer | Slow first parse of big models | `parse.py`, `geometry.py`; spatial index; load meshes per need |
| Item library / client templates | Item texts on classification codes (P14) and Excel edits import are built; no GAEB, no "import a BoQ as template" | | New input or rule-set extension |
| Export | Excel only | | GAEB, ÖNORM A 2063, CSV, IfcCostSchedule |
| Renovation and design options | Renovation: as-modelled's `renovation_scope` / `measure_demolition` (rule-set `scope`, `scope: "out"` items); status read from Revit phasing or IFC `Status` only, other tools' own phase properties not mapped. Design options: field measured, unused | | Map more phase properties as they are met; design options: presets + selectors |
| Units | Imperial output supported by conversion; no imperial presets or descriptions | | Presets |
| Rounding of derived lines | Uses the rule's rounding or the defaults | Fine; noted for QS review | |

## Product (app, Java backend, worker)

**Accounts and billing**
- **No public sign-up and no self-service password reset.** Accounts come from operator setup links
  (`ops/pilot/issue-setup-link.sh`, locally `npm run local:user`) and invitations; resets are
  operator-issued links (P50). Public sign-up needs bot protection decided first (BE-D12).
- **Billing is manual**: checkout answers `409 checkout_unavailable`, the billing webhook
  `400 unsupported_provider` (not audited), no provider adapter. A provider waits for paid
  self-service (BE-D7). No trial automation (admins set `trialEndsAt`; nothing drops an org to Free),
  no downgrade handling (excess projects don't become read-only).
- The session takeover question can't say where the other session is: `sessions.place` is never
  written. The 12 h idle expiry is hard-coded (`identity/Sessions.java`), not configurable (F01).

**Models, BoQs, sheet, viewer**
- **Uploads over 100 MB from the browser are likely broken**: Java answers with multipart part URLs
  (16 MB parts, `storage/ObjectStorage.java`), but the app PUTs the whole file to the first URL
  (`apps/app/src/features/models/upload.ts`). Not verified at runtime. No resume after an
  interruption. The app refuses `.ifczip`, which Java accepts.
- Scope rules per model / BoQ are shown, not editable. Model versions can't be deleted from the UI
  (the endpoint exists); no "used by" or note column.
- No default-preset pickers in project creation or settings (F02).
- The sheet always loads up to 20,000 lines and groups in the browser (no server-side grouping
  above that, F06); item texts are one line (no three-line clamp). The viewer has no merged-mesh
  picking above 200k elements; "Show in 3D" from a question carries at most 300 GlobalIds; the
  shared filter bar lacks IFC class, type, material and "changed since".
- Library: no "rebase on latest", no un-archive (not in the contract), no rename of ids across
  documents, a JSON line diff instead of a structured version diff, no "keep other columns" on
  code-list import.
- Setup wizard is simpler than F16: steps 2 and 3 are the full editors (no "Suggest codes", not
  filtered to names worth asking), no "setup in progress by {name}".
- Audit action names differ from the F09 list (for example `model_version.created`,
  `revision.inputs_updated`, `run.completed`, `line.edited`, `org.setup_done`); no `edits.imported`.

**i18n**
- Engine log entries, some warnings (`rule_set`, `federation_hole`), the answer options of engine
  questions and engine line notes are English text without a code
  (`apps/app/src/i18n/engine-message.ts`). This matters once a second language is added (P07).
- The UI ships English and the pseudo-locale only; emails are English and Serbian
  (`mail/EmailDelivery.java`).

**Security**
- No Content-Security-Policy header is set (app, Java or Traefik), although `security.md` asks for one.

**Operations** ([../operations/pilot.md](../operations/pilot.md))
- **No staging environment** (P51): the pilot at booqlet.com is the only deployed environment and
  every green push to `main` deploys to it. Staging (BE-032) is a future todo.
- Enrolling the first real owner and email delivery to outside addresses are not qualified yet.
  Alerts are log lines only (no destination); no error tracking (needs an account); no exported
  trace store (needs a collector); `ops/pilot/backup.sh` is written and its restore is tested in
  CI, but it is not installed on the host and has no off-host destination (`BACKUP_REMOTE`).
- Local Windows runs of the native queue worker occasionally hung one parse for minutes (seen once;
  CI on Linux hasn't shown it). Investigate if it recurs.
- There is no demo without a backend: running the app needs Docker ([../development/local-setup.md](../development/local-setup.md)).

**Pricing module** (P48): only `openapi-pricing.yaml` and the core's extension points exist. Its only
backend was a plugin of the removed mock, so it needs its Java part (BE-P1…) before anything of it runs.

## Tests

Details and the outcome coverage map: [../testing/README.md](../testing/README.md).

- **The shared contract and scenario suites can't run against the local Docker stack.** They need
  the test-only `SuiteSupport` routes, a test JWT decoder, the `suite_clock` schema and DB-seeded
  sessions, which exist only inside `NativeWorkerTest` (`mvn verify`). Run outside it, the root
  scripts `npm run test:contract` / `test:scenarios` stop at once with a message pointing to the
  harness. A test image of the API (or a "suite" profile) would let them run locally.
- **Browser coverage after P53**: the 106 Playwright tests that ran on the mock were deleted. The
  Java browser suite (`apps/app/e2e-java`, 13 tests) covers sign-in and accounts, sessions, orgs,
  FL-1 to the sample BoQ, upload → parse → BoQ → Excel → share link, and co-editing. Not covered in
  a browser any more: the sheet's edits, questions, viewer, Library editors, versions and changes,
  exports UI, notifications, admin console, setup wizard beyond the suggested answers, the axe
  accessibility checks (TS-003), the pseudo-locale check (v1 criterion 11) and the UI performance
  specs (TS-002).
- The scenario "org presets count against `libraryOrgPresets`" ran only on the mock; Java's library
  limit has no shared scenario. Also untested: `processingMinutesPerMonth`, the `shareLinks` gate,
  rate limits, `invalid_transition`, signed-URL lifetimes, security headers, the `.xlsm` refusal,
  `POST /decisions/{id}/promote`, `PATCH /manual-items/{id}`, project member GET/PATCH, the
  billing webhook; two `it.todo` (24 h `awaiting_upload` expiry, parse retry).
- Java has integration tests (`ApiFoundationTest`, `NativeAuthTest`, `NativeWorkerTest`,
  `BackupRestoreTest`), `AlertMonitorTest` and the ArchUnit `CoreArchitectureTest`, but no unit
  tests for its domain packages (admin, billing, boq, library, model, org, project, …).
- Workbooks are checked with openpyxl only; opening them in Excel and LibreOffice by hand is still to do.
- The accessibility pass by keyboard and screen reader has not been done.
