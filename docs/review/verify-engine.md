# Verification — engine and domain logic

Verifier: engine / domain area. Checked on `main` at `3868013`, 2026-11-23, engine in-process from
`engine/.venv` (Python 3.10.7, ifcopenshell 0.9.0) with the review parse cache
(`docs/review/_scratch/parse-cache/`, JSON-round-tripped, i.e. the worker path), the engine and stack
baselines, and code reading. Nothing was sent to the shared stack (no account was needed; the ReDoS
check was timed locally on purpose). Scripts and their saved outputs:
`docs/review/_scratch/verify-engine/` (`h.py` is the harness: load a sample from the parse cache, run
`get_boq` with a modified rule set or decisions).

## 1. Summary

51 findings checked: **38 verified, 13 adjusted, 0 rejected.**

| Original severity | Count | Verified | Adjusted | Rejected |
|---|---|---|---|---|
| critical | 3 | 3 | 0 | 0 |
| high | 13 | 5 | 8 | 0 |
| medium | 22 | 18 | 4 | 0 |
| low | 13 | 12 | 1 | 0 |

Final severities after verification: **critical 4, high 7, medium 26, low 14.**

Most important corrections:

1. **QS-003 is much broader than "pile caps" and becomes critical.** In both Revit 2021 IFC4 samples
   (S07, S08) the exporter writes `Qto_SlabBaseQuantities.NetArea` = the slab's *total surface area*
   (top + bottom + edges; NetArea > GrossArea on every slab). The engine adopts NetArea first, with no
   area cross-check and no question. Result: **every slab area** in S07 is ×2.22 in sum (2,390 m² vs
   1,077 m² true plan area, 35 slabs), in S08 ×2.54 (1,022 vs 402 m², 37 slabs); ordinary floor slabs
   are +105…+135 %, pile caps +205 % to ×11. Silent, plausible-looking (×2, not ×1000), on the most
   common authoring tool. S03/S05 (other exporters) are exact.
2. **QS-001 / PRD-001 / CAS-001 (same defect) hold, and the root cause is sharper:** the area-source
   table (`engine/ifc_boq/data/quantity_sources.json`) has `Qto_*BaseQuantities.GrossArea` but not
   `BaseQuantities.GrossArea`, so the correct 146.199 m² stated in S09 is never read and the area is
   derived from the ×1000 volume. Answering the two contradiction questions with "geometry" gives
   146.2 m² / 13.24 m³ (reproduced). Critical retained.
3. **ENG-019 is largely already handled:** the change report keeps the engine's value under every
   edited quantity and shows when it moves (`diff.py:10-16`, `changes/model.ts:22-34`, message
   `engineHint`), and line detail reads "X instead of the engine's Y". What is missing is an in-sheet
   flag; downgraded to low.
4. **ENG-011's "worker adopts quantities from a set named 'null'" is wrong:** no source pattern matches
   `"null"`, so on the worker path the unnamed sets' quantities are silently *ignored*, not adopted.
   The CLI crash and the overwrite of same-named sets hold.
5. **ENG-004's layer-breakdown sub-claim is an artefact** of an inconsistent synthetic element; on the
   Duplex the layer breakdown sums to the element (239.77 vs 239.76 m³) while the material breakdown
   gives **1,094.15 m³ vs 239.76 m³ (×4.6)** — the material claim is confirmed and worse than stated.
6. **ENG-006 is worse than stated:** a catastrophic regex holds the GIL, so it freezes the *whole*
   rpc process, not one thread (a second thread got 1 iteration in 6.7 s).
7. Severity downgrades: ENG-003 (custom-rule-only combination) high→medium; QS-004 high→medium
   (subset of walls, flagged by a thickness contradiction); QS-007 high→medium (classification only,
   illustrative ACME preset); CAS-004 high→medium (parent terms `membrane`, `finish`, `air_gap` exist;
   the problem is search/synonyms and no "Leave it"); LEAD-003 high→medium (feature gap); ENG-009
   medium→low. Upgrade: ENG-020 low→medium.
8. Side observation (not assigned to anyone as far as I can see): **S10 (65 MB Dutch model) resolves
   "0 of 0 distinct names"** and is `complete` with 0 questions, so it is not evidence for "Dutch names
   are much worse" (PRD-006); it suggests S10's materials/types are not reaching the names stage at all
   — worth a separate look.

## 2. Table

| ID | Source report | Title (short) | Original severity | Verdict | Final severity | Final category | Evidence of check | Correction / reason | Duplicates / related |
|---|---|---|---|---|---|---|---|---|---|
| ENG-001 | 01-engineering | Non-ASCII string literals decoded wrongly in expressions | high | verified | high | correctness | `expr.py:145`; `expr_checks.out`: `"béton"`→`'bÃ©ton'`, `CONTAINS(name,"béton")` on "Béton armé" → False, `name = "Ziegel ä"` → False | Scope: rule selectors/`expr`, map `where`, dictionary `when`, line-key and template expressions. Dictionary *entry* matching (exact/contains/regex, `names.py:71-90`) does not use the evaluator and is unaffected. No system preset has a non-ASCII expression literal (scanned `presets/**`), so it bites custom rules only — but silently | ENG-008 (its repro uses this), ENG-027 |
| ENG-003 | 01-engineering | Duplicate `missing:` question ids per part → ingestion fails, "retryable" | high | adjusted | medium | correctness / robustness | `rules.py:623`; `eng003.out`: Duplex + layer breakdown + `onMissing: ask` → 50 duplicated ids (e.g. `missing:dupq:2O2Fr$t4X7Zf8NOew3FKau` ×7); `V7__boqs_and_runs.sql:149` PK; `JobDispatcher.java:151` `retryable=true` | Claim holds. Severity: needs a custom rule combining a non-element breakdown with `onMissing: ask`; no shipped item does (as-modelled `ask` items all use element breakdown). Workaround: change the rule. Medium, not high | FM-111 |
| ENG-004 | 01-engineering | Breakdown `material` gives each material the whole gross volume | high | adjusted | high | correctness | `rules.py:458-463`; `eng004.out` on the Duplex walls: element gross 239.76, layer gross 239.77, **material gross 1,094.15 m³**; net volumes all 207.07–207.08 | Material claim confirmed and larger than in the report (×4.6 on real walls). The "layer breakdown also wrong" sub-claim is wrong: it came from a synthetic element whose gross volume ≠ gross area × thickness. Offered in the rule editor, also as rule-set default (`item-forms.tsx:105-107`, `overview.tsx:73`) | FM-111 |
| ENG-005 | 01-engineering | FLOOR/CEIL with step: float errors | medium | verified | medium | correctness | `expr.py:249-255`; `expr_checks.out`: `FLOOR(0.3,0.1)=0.2`, `FLOOR(4.35,0.05)=4.3`, `CEIL(0.3,0.1)=0.30000000000000004` | Also `ROUND(0.3,0.1)=0.30000000000000004` (right step, float tail); rule rounding (`rules.py:429-438`) is correct. No preset uses FLOOR/CEIL with a step | — |
| ENG-006 | 01-engineering | User regexes unbounded: ReDoS on the shared engine | high | verified | high | security | `Models.java:308-331` (`visible` = view; draft dictionaries forwarded), `names.py:84-89`, `rules.py:146-147`, `presets.py:378-383` (compile only); `redos_gil.out`: 16→22 chars 0.009→0.557 s (×4 per 2 chars); 25 chars 6.7 s | Worse than stated: `re` holds the GIL, so a second thread got **1 iteration in 6.7 s** — one request freezes the whole rpc process (checks, names, code-list and template ops for every tenant). Not sent to the shared stack | ENG-022, FM-74, FM-113 |
| ENG-008 | 01-engineering | Two rules on one element both count it unless `claims` | medium | verified | medium | spec-issue | `rules.py:494-561`: every enabled rule takes every matching element; only `claims` (`:540-542`) detect double counts; `rules-language.md:225` | By design (wall + paint + formwork legitimately share an element). Recommendation risk: "claim `body` by default" or "warn whenever an element feeds two lines" would fire on every derived/finish rule; scope it to item rules of the same family/quantity kind | ENG-001 |
| ENG-009 | 01-engineering | Blocking decided by regex over the rule set JSON | medium | adjusted | low | correctness | `rules.py:104-111`; repro: item labelled "Walls (any material)" → `{'material'}`, without the word → `set()` | Holds, but the system presets genuinely reference `material`, `element_type` etc., so the false positive only changes custom sets, and the effect is extra blocking questions (no wrong number). Low | QS-022 |
| ENG-010 | 01-engineering | Unknown units ×1, no dimension check, minimum in SI vs rounding in output unit | medium | verified | medium | correctness / spec-issue | `rules.py:26-29,427`: `convert(2.5, cm/l/mm2/in/g)` → 2.5; `presets.check` accepts unit `cm`, `l`, `furlong`, and `length` in `m2` (no problems returned); app `vocab.ts:108` "any other text is allowed"; element minimum compared before conversion (`rules.py:654-660`), rounding after (`:663-667`) | Also: `mm` on an *area* quantity multiplies by 1000 (factor table is not per dimension) | ENG-030, FM-115 |
| ENG-011 | 01-engineering | Null/duplicate pset names: CLI crash, worker divergence, overwrite | medium | adjusted | medium | robustness | `parse.py:217,219`; `baseline/engine/S12-default/traceback.txt` (`measure.py:121` TypeError); `quantity_sources.json` has no wildcard pattern that matches `"null"` | Correction: on the worker path the `"null"` set is **not** adopted — no source pattern matches it, so its quantities are silently ignored. Crash in-process and same-name overwrite hold | 00-context §10 |
| ENG-012 | 01-engineering | Truncated IFC: uninformative error | low | verified | low | robustness | `parse.py:474`; `baseline/engine/S13-default/traceback.txt`; `baseline/stack/S13-default/parse-S13.json` → `parse_error` "Could not parse IFC model"; `worker.py:134-139` | — | — |
| ENG-013 | 01-engineering | Deep nesting → RecursionError → 503 | low | verified | low | robustness | `syntax_problem("("*2000+"TRUE"+")"*2000)` raises `RecursionError` (not caught, `expr.py:195-200`); `worker_http.py:92` maps only KeyError/TypeError/ValueError | — | — |
| ENG-017 | 01-engineering | Client re-implements item text / slot rename | low | verified | low | duplication | `item-text.ts:35` `[^{}]*` vs `templates.py:8` `[^{}]+`; `doc.ts:48` regex rename over all strings, `from` unescaped | Mitigation: the preview uses the engine's filled text when a preview line exists (`engineText`, TF-136) | — |
| ENG-018 | 01-engineering | Excel import reads "1,234" as 1.234 | medium | verified | medium | correctness | `boq_import.py:45-54`; repro `number('1,234')=(1.234,True)`, `number('1.234')=(1.234,True)`, `number('1.234,5')` refused | Only text cells; numeric cells unaffected | FM-114 |
| ENG-019 | 01-engineering | Line edit never flagged when the engine value under it moves | medium | adjusted | low | spec-issue | `overrides.py:25-28` keeps `engineQuantity`; `diff.py:10-16` puts it in the change snapshot; `Diffs.java:146`; `changes/model.ts:22-34` `engineChange`; message `boqs.json:590` `engineHint`; line detail `trace_edit_quantity` "instead of the engine's {engineQuantity}" | The change report already flags "edited line, engine value moved" (BR-09, TF-093) and the line shows the current engine value. Missing: a flag/question in the sheet itself and the value at edit time. Low | FM-112 |
| ENG-020 | 01-engineering | Overlaps and unmatched non-blocking → "complete" | low | adjusted | medium | spec-issue | `federation.py:399` `blocking: False`, `suggestion: "both"` (both copies counted until answered); `pipeline.py:303,376-377` | Upgraded: an unanswered overlap keeps both copies (a double count) under status "complete"; same root as QS-002 (quantity-affecting questions never block) | QS-002, QS-006 |
| ENG-021 | 01-engineering | Mass and property-level units not converted | low | verified | low | correctness | `parse.py:204-205` `WeightValue` unscaled (L/A/V scaled, `:129-131`); `prop_value` converts by measure type only, ignores `IfcPropertySingleValue.Unit` | Reported mass feeds `mass` (`measure.py:471`); steel rules mostly use kg/m or volume × density, so impact is small | — |
| ENG-022 | 01-engineering | Dictionary regex documented as ECMAScript, runs on Python `re` | low | verified | low | spec-drift | `dictionary.ts:73`; `names.py:35-37`; `\p{L}+` → "bad escape", variable lookbehind refused | Minor correction: no client-side regex tester exists in the library editor (only engine-side checks), so "works in the browser tester" is hypothetical; the doc/engine drift holds | ENG-006 |
| ENG-023 | 01-engineering | `addReveals` with surface `both` doubles reveals | low | verified | low | correctness | `rules.py:286-293,362-366`: per face adds full `(2h+w)×depth` (depth = opening depth or full thickness), then ×2 | Convention-dependent, as the reporter says | QS-020 |
| ENG-025 | 01-engineering | Parse memory grows with geometry; meshes held to the end | medium | verified | medium | performance | `parse.py:372` `self.meshes[guid] = m`; baseline peaks S07 1,597.6 MB (13.6 MB file), S08 769.6, S10 796.5, S06 555.4; pilot queue worker 4 GB, interactive 2 GB, http 1536m (`ops/pilot/compose.yaml:138,157,169`) | The "40–60 MB Revit model OOMs" is an extrapolation, not measured | FM-82, ENG-026 |
| ENG-026 | 01-engineering | Parse CPU mostly Python post-processing | low | verified | low | performance | `_scratch/eng/s06.txt`: run_geometry 83.5 s cum. of 106.6; mass_properties 13.7 s, fix_winding 13.0, oriented_box 14.8, pset_dict 7.0, is_watertight 8.5 | Minor: `mass_properties` ran 1,760× for 968 meshes (≈1.8× per mesh thanks to trimesh caching), not 3× | ENG-025 |
| ENG-027 | 01-engineering | Weak test oracles; new defects untested | medium | verified | medium | testing | `tests/scenarios/sheet.test.ts:221` filters by `inLines` then asserts `inLines` (cannot fail); `test_duplex.py:75-76` ignores `unit`; `test_certification_samples.py:80-84` passes if all totals are equal (incl. all 0) | — | QS-021 |
| QS-001 | 04-civil-engineer | S09 slab ×1000 (reported volume adopted, area derived from it) | critical | verified | critical | quantity-accuracy | `qs001.out`: "Slab, Floor-Grnd-Susp…" 146,199.06 m², "Slab, Simple floor" 80,262.86 m², "In-situ concrete, Simple floor" 13,243.37 m³, source `measured`, notes `[]`; contradiction questions `blocking False`, recommended `reported`; building gross_volume 443,773 m³; Excel `S09-default/boq.xlsx` rows 15/19/49 unfilled. `qs010.out`: with "geometry" answers 146.2 m² / 80.26 m² / 13.24 m³ | Root cause refined: S09 states `BaseQuantities.GrossArea = 146.199` but the area sources list only `Qto_*BaseQuantities.GrossArea` (`quantity_sources.json`), so the area falls to `volume / thickness` (`measure.py:360-365`) on the ×1000 volume. Two defects: missing source + adopting a reported value that is an exact ×1000 of a closed mesh | PRD-001, CAS-001, LEAD-016, QS-002, QS-013 |
| QS-002 | 04-civil-engineer | Contradictions never block and recommend the file's value; names block | high | verified | high | review-queue | `measure.py:522-531` (`blocking: False`, `reported` recommended always); `qs001.out` S09 question list (2 contradictions non-blocking, 8 names blocking); S07 baseline 4 non-blocking contradictions vs 61 blocking names | Recommendation is sound; the "allows for joins" reason is right for walls ±few %, not for ×1000 or −74 % | QS-001, ENG-020, QS-022 |
| QS-003 | 04-civil-engineer | Pile caps take area/thickness from bad Revit Qto; no area check | high | adjusted | **critical** | quantity-accuracy | `qs003.out`: pile cap `3OQjd9jwr1COqcP44Fm6DW` Qto NetArea 44.08 / GrossArea 14.44 / Width 3.8; app area 44.08, edge formwork 57.76 (15.2 × 3.8), thickness question (3.8 vs 1.0) non-blocking. `qs003b.out` + `slab_area_survey.out`: every S08 slab NetArea = mesh surface area (e.g. "Insitu Concrete 250mm" 164.07 = surface, GrossArea 70.07); S07 35 slabs ×2.22, S08 37 slabs ×2.54; S03/S05 ×1.00 | Broadened: not just pile caps — **all slab areas** from these Revit 2021 IFC4 exports are roughly doubled, silently (no question at all), and everything derived from slab area (e.g. hardcore) follows. NetArea > GrossArea, impossible by the Qto definition, is not checked. Critical | QS-013 (Pad 2 921 m² is partly this), FM-95 |
| QS-004 | 04-civil-engineer | Wall area = volume ÷ layer thickness understates non-prismatic walls | high | adjusted | medium | measurement-rule | S05 baseline log: party wall `…FKau` "volume / thickness = 25.8301 / 0.55 = 46.964 m2 … faces a 49.201 / b 49.201"; stub `…` 3.656 vs faces 6.149; line 71.67 vs faces 78.83 (−9.1 %); `qs010.out` geometry answer → 76.6 | Claim holds. Severity: affects a subset (S05 4/57, S07 4/47, S08 1/9 walls per the reporter's survey) and the S05 cases are flagged by a thickness contradiction question; uniform walls are exact. Medium | QS-021, QS-017 |
| QS-005 | 04-civil-engineer | Footing formwork = 2 × length × height | high | verified | high | measurement-rule | `as-modelled.json:299-322` default `2 * src.length * src.height`; S04 baseline "Formwork to sides of foundations" 3.72 m² (ring footing, 0.3 m high, 12.31 m² plan) | For a square pad the default is −50 %, for a ring −75 %; formwork ON by default (`formwork_separate: true`) | — |
| QS-006 | 04-civil-engineer | Federation resolves conflicting same-GlobalId copies silently | high | verified | high | federation | `federation.py:160-184` (score = has body, owned by its model's discipline, model order); F01 baseline log: `1cCK8nA61FduUezO75i8dB` 225 mm (arc, 152.1 m²) vs 250 mm (str), kept from arc; `0NWseyvsH7_gBW225aGtuD` 24.29 vs 45.25 m², kept from arc; 24 `log.federation.duplicate` entries, warnings only `federation_hole`/`mixed_line`, no question | Ownership is evaluated on each copy's own properties, so when both copies pass, model order decides; I could not pin which branch applied without S07's parse (not cached), but the kept-from-arc outcome for structure-owned concrete is in the log | ENG-020 |
| QS-007 | 04-civil-engineer | Unrecognised walls coded "Internal walls" even when IsExternal | high | adjusted | medium | classification | `acme-cost-codes/map.json` `internal-walls` = `{"tag":"wall"}` catch-all; baselines: S01, S09 Wall-Ext, S07 CL_W1/Retaining/SIP/Timber Clad (`is_external` True) → D.02 | Holds. Severity: classification only (quantities unchanged, rule 6), and ACME is an illustrative preset a firm replaces. Medium | PRD-009 / FM-121 |
| QS-008 | 04-civil-engineer | Partially measured line not flagged | medium | verified | medium | review-queue | `rules.py:727-733`; S09 baseline "Wall, Wall-Ext…" 44.13, source `measured`, note "1 of 3 element(s) had no value…", `flaggedLines` 4 | — | — |
| QS-009 | 04-civil-engineer | Paint ignores the wall opening rule; centreline area | medium | verified | medium | measurement-rule | `as-modelled.json:763-781`; S05 default vs tweaked: brick-on-block 267.16 → 274.62, paint 703.19 in both | — | QS-020 |
| QS-010 | 04-civil-engineer | Quantity-changing decisions invisible on the line and in stats | medium | verified | medium | traceability | `qs010.out`: S09 and S05 with geometry answers → `decisionsApplied 0`, line source `measured`, notes `[]`; `pipeline.py:344` counts only raised questions | Note: the result does list them in `answeredQuestionIds` (TF-137), so the run record has them; the stat, the line and the Excel "Decisions applied" do not | QS-011 |
| QS-011 | 04-civil-engineer | Line detail omits measured inputs and provenance | medium | verified | medium | traceability | `line-detail.tsx:273-285` shows `line.log`; `RunReads.java:140` selects log entries by `lineKey`; measure-stage entries carry only `guid` | Workaround: Log tab filter by GlobalId (`log-tab.tsx:57`) | QS-010 |
| QS-012 | 04-civil-engineer | Steel mass from analytical Length | low | verified | low | quantity-accuracy | S05 log: "mass = length x nominal kg/m = 7.523 x 60 = 451.38 kg"; length sources `PSet_Revit_Dimensions.Length` (`quantity_sources.json`); `measure.py:100-107` W shapes only | — | FM-86 |
| QS-013 | 04-civil-engineer | No plausibility checks on what an element is | medium | verified | medium | measurement-rule | S07 baseline lines "Slab, Pad 2" 921.16 m², "Slab, 600mm Diameter" 63.78 m² | Pad 2's 921 m² is also doubled by the NetArea defect (true plan ≈ 437 m², `slab_area_survey.out`) | QS-003, QS-001, LEAD-016 |
| QS-014 | 04-civil-engineer | Proxies (people, trees, plates) counted by default | medium | verified | medium | measurement-rule / spec-issue | `as-modelled.json:961-964` `include_proxies: true`; S07 baseline "Unclassified object Honey Locust - 25' 8 nr", "Fine China - Plate 8 nr", Miele appliances… | — | — |
| QS-015 | 04-civil-engineer | Concrete columns/beams by length only; no frame item | medium | adjusted | medium | measurement-rule | `as-modelled.json` `members_measure` options `length/count/volume`; derived items: formwork only for walls, slab edges, footings; rebar only slabs/walls/footings | Correction: m³ is available through the slot "Other members measured by: Volume" (one switch for timber and concrete together, default length). Formwork and rebar for frames are indeed absent | — |
| QS-017 | 04-civil-engineer | Sample project seeds decisions in the user's name | medium | verified | medium | traceability | `SampleProjects.java:68-71`: two `contradiction … "reported"` decisions saved with `seed.actor()` | — | QS-004 |
| QS-018 | 04-civil-engineer | Unhosted window counted, no warning | low | verified | low | missing data | Duplex v2 re-run: no opening fills `1FM6kRbt1Q98O7nMvcxWi0`, warnings `[]`, only generic info checks, counted in "Window M_Fixed, 819mm x 759mm"; `federation_unhosted` exists only in federation (`federation.py:497-528`) | — | — |
| QS-020 | 04-civil-engineer | "Add reveals back" applies to the wall item | low | verified | low | spec-issue | `as-modelled.json:497-505` slot in section openings, used by the walls item (`:1089,1172`) | — | ENG-023, QS-009 |
| QS-021 | 04-civil-engineer | Duplex acceptance test circular for walls | medium | verified | medium | spec-issue / testing | `test_duplex.py:27-28` `26.861 / 0.417`, party wall 71.670; `engine-validation.md:42` "All walls measured as Volume / thickness" | — | QS-004, ENG-027 |
| QS-022 | 04-civil-engineer | Naming questions dominate the review queue | medium | verified | medium | review-queue | Baseline questions: S07 61 blocking `unknown_name` of 67; S03 9/9 blocking; S09 9 blocking names; seed `rx-external-wall` = `(exterior\|external\|fasad\|au[sß]enwand)` | — | PRD-006, CAS-004, ENG-009 |
| QS-023 | 04-civil-engineer | Slab-edge formwork choices vs perimeter incl. openings | low | verified | low | spec-issue | `as-modelled.json:274-286`; `measure.py:395-405` geometric perimeter "(includes the edges of openings…)" | When the perimeter is reported (Qto `Perimeter`), whether openings are in it depends on the exporter | — |
| CAS-001 | 03-casual-user | S09 slab ×1000; recommended answer keeps it | critical | verified | critical | trust | Same reproduction as QS-001 (`qs001.out`, `qs010.out`) | Its root-cause statement ("area derived from the bad volume although a correct GrossArea is right there") is exactly right; see QS-001 | QS-001, PRD-001, LEAD-016 |
| CAS-004 | 03-casual-user | Blocking material questions with tiny vocabulary, no way out | high | adjusted | medium | dead-end | `questions-tab.tsx:262-265` "Leave it" only when `!q.blocking`; seed terms (56) include `membrane`, `finish`, `air_gap`, `bituminous` | Correction: the vocabulary has fitting parent terms ("Damp-proofing" is a membrane, "Laminate" a finish, "Air" an air gap) — the user's "guesses" were defensible. The dead end is the term search (no synonyms: "damp", "laminat", "bitumen" find nothing) plus no "Leave it" on blocking questions. Medium | PRD-006, QS-022 |
| CAS-017 | 03-casual-user | "In-situ concrete" counts the whole 470 mm floor build-up | medium | verified | medium | trust | `slab-concrete` item: `material under concrete` + whole `net_volume` (as-modelled); S09 floor layer set: screed 0.065, vapour 0, insulation 0.08, Air 0.15, damp-proofing 0, block 0.10, precast 0.075; `lead003.out`: with Air→`air_gap` the line appears (68,713.56 m³ unanswered contradiction), with Air→`insulation` it does not | Cause: the element's "main material" is the thickest *solid* layer (`measure.py:240-242`); when it is concrete-like, the whole build-up (incl. a 150 mm air gap) becomes in-situ concrete | LEAD-003, QS-001 |
| CAS-018 | 03-casual-user | Main roof has no quantity and no hint | medium | verified | medium | trust | S09 baseline: roof line `None`, `flagged`, "quantity could not be determined"; element is a closed Brep, 13.57 m³ from geometry, plain material (no layer set) → no thickness, no area | The line is flagged (not silent); the engine could derive an area from the closed mesh (oriented-box thickness, as slabs do) | — |
| CAS-025 | 03-casual-user | Two "Edge formwork to slabs" lines | low | verified | low | confusion | S05 baseline: 8.78 and 6.11 m² with identical descriptions | Broader: S05-standard has 6 such groups (formwork to walls, rebar, layer and paint lines); S07 two "Wall, Wall - Timber Clad, 202 mm" lines differing only in a hidden `is_external` key | QS-016 |
| PRD-001 | 02-product | First BoQ from a public sample: ×1000, "measured", "COMPLETE" | critical | verified | critical | launch-readiness | Same as QS-001; `lead003.out` shows status `complete` with "In-situ concrete, Floor-Grnd-Susp…" 68,713.56 m³ once the names are answered | — | QS-001, CAS-001, LEAD-016 |
| PRD-006 | 02-product | Names are the main blocker; vocabulary tiny | high | adjusted | high | feature-gap | `global-seed.json`: 56 terms / 68 entries; baselines S07 61, S03 9, S09 9 blocking names | Overstated parts: "every real model starts in needs input" — S05, S06, S10 (and S02, S04 on the stack) are `complete`; "Dutch S10 much worse" — S10 resolves 0 of 0 names (no names reach the stage at all), so it is not evidence. Core holds | QS-022, CAS-004 |
| LEAD-003 | 05-team-lead | Same model, different estimators, different BoQs | high | adjusted | medium | consistency / feature-gap | `Decisions.java:141` `not_promotable` for non-name answers; `lead003.out`: Air `air_gap` vs `insulation` → House A has "In-situ concrete…" 68,713.56 m³ + "Edge formwork to slabs" 24 m², House B neither | Mechanism confirmed. Different answers giving different numbers is expected; the gap is org-level answer policy/conflict reporting. The size of the difference here comes from QS-001 and CAS-017. Medium | CAS-017, QS-001 |
| LEAD-016 | 05-team-lead | Absurd quantities raise no warning | medium | verified | medium | qa-controls | `qs001.out` (146,199 m², 80,262 m², source `measured`, notes empty); no plausibility warnings in `warnings` | Cause is QS-001; the plausibility-check recommendation stands on its own | QS-001, QS-013 |

## 3. Details

### QS-001 / PRD-001 / CAS-001 — S09 ×1000 (critical, verified)

```
$ PYTHONUTF8=1 engine/.venv/Scripts/python docs/review/_scratch/verify-engine/qs001.py
status needs_input lines 15
  Slab, Floor-Grnd-Susp_65Scr-80Ins-100Blk-75PC     146199.06 m2 source=measured notes=[]
  In-situ concrete, Simple floor                     13243.37 m3 source=measured notes=[]
  Slab, Simple floor                                 80262.86 m2 source=measured notes=[]
Q contradiction:volume:IfcSlab:Floor-Grnd-Susp… blocking False recommended ['reported'] | … disagree by -100% (e.g. 68713.556 m3 from BaseQuantities.GrossVolume …
Q contradiction:volume:IfcSlab:Simple floor     blocking False recommended ['reported'] | …
building {… 'gross_floor_area': 226461.92, 'footprint_area': 146199.06, 'gross_volume': 443773.44}
```
The parsed element (worker path): `BaseQuantities: {GrossArea 146.199056, GrossVolume 68713.556438,
Perimeter 51.07, Width 0.47}`, geometry volume 68.713556, closed. Area sources (from
`quantity_sources.json`): `Qto_SlabBaseQuantities.NetArea`, …, `BaseQuantities.NetArea`,
`BaseQuantities.NetSideArea`, `Qto_*BaseQuantities.GrossArea`, … — **no `BaseQuantities.GrossArea`**.
So `rep["area"]` is empty and `measure.py:360-365` derives `area = 68,713.556 / 0.47`.
With both contradiction questions answered `geometry` (`qs010.py`): 146.2 m², 80.26 m², 13.24 m³.
Excel (`baseline/engine/S09-default/boq.xlsx` BoQ rows 15/19/49): plain "measured", fill `00000000`.
Severity: kept critical. The trigger is a defective export, but the engine has a closed mesh with an
exact ×1000 ratio, recommends the wrong value, raises no area question, and the BoQ reaches
`complete` once names are answered (PRD-001's claim, reproduced in `lead003.out`).

### QS-003 — Revit 2021 IFC4 slab areas doubled (adjusted: broadened, high → critical)

```
$ … qs003.py   (S08 pile cap 3OQjd9jwr1COqcP44Fm6DW)
reported {'Qto_SlabBaseQuantities': {'GrossArea': 14.44, 'NetArea': 44.08, 'GrossVolume': 14440.0, 'NetVolume': 14.44, 'Perimeter': 15.2, 'Width': 3.8}}
geom vol 14.44 obb [3.8, 3.8, 1.0]
  line slab-concrete       In-situ concrete, 3800 x 3800 x 600mm  14.44 m3
  line formwork-slab-edges Edge formwork to slabs                 57.76 m2
  line slabs               Slab, 3800 x 3800 x 600mm              44.08 m2
Q contradiction:thickness:IfcSlab:3800 x 3800 x 600mm False … 3.8 m from Qto_SlabBaseQuantities.Width vs 1 m measured …
```
Then every S08 floor slab:
```
Floor:Insitu Concrete       NetArea  90.571  GrossArea  38.46   geoSurf  90.571  geoV/W  38.46
Floor:Insitu Concrete 250mm NetArea 164.071  GrossArea  70.074  geoSurf 164.071  geoV/W  70.07
Floor:Plywood double brace  NetArea 182.040  GrossArea  90.071  geoSurf 182.040  geoV/W  90.07
```
NetArea equals the mesh's total surface area on every slab. Across the baseline logs
(`slab_area_survey.py`, adopted area vs volume ÷ thickness):
```
S07-default: 35 slabs; sum reported 2390.2 m2 vs volume/thickness 1076.6 m2 (x2.22)
S08-default: 37 slabs; sum reported 1022.5 m2 vs volume/thickness  402.4 m2 (x2.54)
S05-default: 20 slabs; x1.00      S03-default: 3 slabs; x1.00
```
S08 line totals (`qs003b.out`): "Slab, Insitu Concrete" 327.60 m² vs Qto GrossArea 143.78; "Slab, Insitu
Concrete 250mm" 164.07 vs 70.07. No question of any kind is raised about areas (there is no area
contradiction check, FM-95), and NetArea > GrossArea is not tested. This is a silent ~2× over-count
of every slab area from the Revit 2021 IFC4 exporter in both samples from it — hence critical. The
pile-cap thickness part of QS-003 (Width 3.8 used as thickness → formwork 57.76) is confirmed too.
Prevalence beyond this exporter version is unknown (two files, one exporter).

### QS-002 — contradictions never block (high, verified)

`measure.py:527-531`: every `contradiction` question is `blocking: False`, `suggestion: "reported"`,
option `reported` `recommended: True`, regardless of the size of the difference. S09: 2 contradictions
non-blocking at −100 %, 8 name questions blocking (`qs001.out`). S07 baseline: 4 non-blocking
contradictions, 61 blocking names. Holds as stated.

### QS-005 — footing formwork (high, verified)

`as-modelled.json:299-322`: default and "two long sides" `2 * src.length * src.height`; the "all
four sides" choice uses the bounding box. S04 baseline: "Formwork to sides of foundations" 3.72 m²
for a ring footing (2 × 6.2 × 0.3). The reporter's 15.15 m² is their mesh measurement; I did not
re-measure the faces, but the arithmetic of the default for a ring (outer ≈ 2·(5.8+6.2) = 24 m plus
the inner edge, × 0.3) is consistent with ≈ 15 m², and a square pad gets half its formwork by
construction. High kept: formwork is on by default and pads are common.

### QS-006 — federation duplicates (high, verified)

F01 baseline log (`result.json.gz`): `1cCK8nA61FduUezO75i8dB` "Insitu Concrete 225mm" (arc: thickness
0.225, area 152.121) vs "Insitu Concrete 250mm" (str: thickness 0.45, area 164.071) → "same GlobalId
in 2 models; kept from S07-revit-arc-ifc4.ifc"; `0NWseyvsH7_gBW225aGtuD` CL_W1 24.29 m² (arc) vs
45.252 m² (str) → kept from arc; 24 such entries; `warnings` only `federation_hole` ×7 and
`mixed_line` ×4; question kinds only contradiction/unknown_name/unmatched. The score
(`federation.py:166-169`) evaluates ownership on each copy's own properties; a tie falls to model
order. Holds; high kept (material differences between disciplines are hidden).

### QS-004 — wall area method (adjusted, high → medium)

S05 baseline log for `2O2Fr$t4X7Zf8NOew3FKau`: "net area = volume / thickness = 25.8301 / 0.55 =
46.964 m2 … faces a 49.201 / b 49.201 m2 net"; the stub: 3.656 vs faces 6.149. The line is 71.67 m²
vs 78.83 m² of faces (−9.1 %); answering the thickness/volume contradictions "geometry" gives 76.6.
Downgraded because the method is exact on uniform prisms (the large majority: S05 53/57 walls,
S07 43/47 by the reporter's survey) and the S05 cases come with a thickness contradiction question;
it is a measurement-rule choice documented in `measure.py:19-20` and `engine-validation.md:42`, worth
changing, but not "wrong numbers in common cases".

### QS-007 — wall codes (adjusted, high → medium)

`acme-cost-codes/map.json`: `external-walls` needs `UNDER(element_type,"wall.external")`,
`internal-walls` is `{"tag":"wall"}`. Baselines: S01 (`is_external` True) D.02; S09 "Wall-Ext…" D.02;
S07 CL_W1, Retaining, SIP, Timber Clad (True) D.02. Holds. Medium because no quantity changes and
ACME is an illustrative placeholder preset (the firm's own map is the product's intent); still worth
an `is_external` fallback and a non-catch-all default in shipped maps.

### QS-015 — concrete frames (adjusted)

`members_measure` offers `volume` ("Volume (m3)") for "beams, columns and members that are not
steel"; so m³ is one slot away, but it switches timber too, and there is no column/beam formwork or
rebar derived item (`derived`: formwork-walls/slab-edges/footings, rebar slabs/walls/footings).

### ENG-001 — non-ASCII literals (high, verified)

```
lit béton -> 'bÃ©ton'
CONTAINS -> False        (name = 'Béton armé')
eq Ziegel ä -> False     (name = 'Ziegel ä')
eq ASCII -> True
```
`expr.py:145` `bytes(v[1:-1], "utf-8").decode("unicode_escape")` decodes UTF-8 bytes as Latin-1.
Bracket keys (`props["Pset_ä.X"]`) are not decoded and stay correct. High kept: silent mis-selection
in any custom rule or map written in a non-English language (DACH/CEE first market), even though
no shipped preset triggers it. The recommendation (explicit escape table) is right.

### ENG-003 — duplicate question ids (adjusted, high → medium)

```
$ … eng003.py   (Duplex, item: IfcWall/IfcWallStandardCase, quantity NULL, breakdown layer, onMissing ask)
status needs_input questions 206 duplicate ids 50
[('missing:dupq:2O2Fr$t4X7Zf8NOew3FKau', 7), ('missing:dupq:2O2Fr$t4X7Zf8NOew3FNtn', 6), …]
```
With `run_questions PRIMARY KEY(run_id, question_id)` the COPY fails, and `JobDispatcher.java:151`
marks it `retryable: true`. Engine half reproduced; the ingest half rests on the PK and the
reporter's log. Downgraded because only a custom rule pairing a non-element breakdown (layer, face,
material, child) with `onMissing: ask` triggers it.

### ENG-004 — material breakdown (adjusted, high kept)

```
$ … eng004.py   (Duplex walls, one item, lineKey material)
element   gross total m3 =   239.760     element   net total m3 = 207.070
layer     gross total m3 =   239.770     layer     net total m3 = 207.080
material  gross total m3 =  1094.150     material  net total m3 = 207.080
```
Material parts set `net_volume` and `thickness` but inherit the element's `gross_volume`
(`rules.py:458-463`); every material line gets the whole wall. The layer breakdown is consistent on
real data, so that sub-claim is dropped. High kept: silent ×N over-count, reachable from the rule
editor and as the rule-set default breakdown.

### ENG-006 — ReDoS (high, verified, impact broader)

```
$ … redos_gil.py
16 chars 0.009 s / 18 chars 0.034 s / 20 chars 0.133 s / 22 chars 0.557 s
25-char name: regex 6.68 s; a second thread doing sleep(0.05) loops got 1 iteration(s) meanwhile
```
`Models.names` needs only `visible()` (view) and forwards `draftDictionaries` unvalidated to the
rpc `names` op; `presets.check` only compiles patterns. Because `re` keeps the GIL during matching,
one pattern stalls the entire FastAPI rpc process; the API's 15 s rpc timeout frees the caller, not
the engine. Not tried on the shared stack (would freeze it for the other verifiers).

### Adjusted medium/low findings

- **ENG-009** (medium → low): reproduced (`"Walls (any material)"` → `{'material'}`); only affects
  custom sets, and only by adding blocking questions.
- **ENG-011** (medium kept): see table — the `"null"` set is ignored on the worker path, not adopted.
- **ENG-019** (medium → low): the engine value under an edit is in the change report and line detail
  (evidence in table); remaining gap is an in-sheet "basis moved" flag and the value at edit time.
- **ENG-020** (low → medium): an unanswered overlap counts both copies (`suggestion: "both"`) under
  "complete".
- **CAS-004**, **PRD-006**, **LEAD-003**: see table.

## 4. Judgement calls

- **Worker path as the reference.** All engine runs used the JSON-round-tripped parse cache, i.e.
  what the worker sees; where the CLI path differs (ENG-011, S12) I say so.
- **QS-003 to critical.** I rate the slab-NetArea doubling above QS-001 in risk: it is ~2×, plausible
  to the eye, raises no question, and affects every slab of two of the three Revit samples. I did not
  verify how many Revit exporter versions write NetArea this way; the rating assumes Revit 2021 IFC4
  exports are common in the pilot's market.
- **Critical kept for QS-001 family** even though it starts from a defective file: the engine
  detects the conflict, recommends the wrong value, and lets the BoQ become `complete`.
- **Custom-rule-only defects** (ENG-001, ENG-003, ENG-004): rated by whether the failure is silent
  and how large it is. ENG-001/ENG-004 are silent wrong numbers (high); ENG-003 fails loudly
  (medium).
- **Classification-only defects** (QS-007) rated below quantity defects, per CLAUDE.md rule 6.
- **QS-005 face area (15.15 m²)** not re-measured; the verdict rests on the formula and the default.
- **QS-006 cause** not pinned to a branch of the ownership score without parsing S07 (1.6 GB peak on
  a shared machine); the outcome is in the baseline log.
- **ENG-006** checked locally only; the GIL test is a plain-Python model of the rpc thread pool.
- **Duplicates noted** for consolidation: QS-001 = PRD-001 = CAS-001 (+ LEAD-016 symptom);
  QS-022 ≈ PRD-006 ≈ CAS-004; CAS-025 ≈ QS-016; ENG-023 ~ QS-020; ENG-027 ~ QS-021; ENG-020 ~ QS-002;
  CAS-017 ~ LEAD-003 (same "main material" mechanism).
- **Recommendations to treat with care:** ENG-008's "claim body by default" (would flag every
  finish/formwork rule); QS-002's "downgrade name questions that only affect a code" (name answers
  also move quantities, e.g. Air → `air_gap` creates a 68,713 m³ concrete line in `lead003.out`).
