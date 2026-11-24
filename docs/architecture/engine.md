# Engine

The Python package `engine/ifc_boq`. It runs as the Java backend's worker (job contract:
[engine-worker.md](engine-worker.md)) and from the command line. Public surface (keep it this
small; the worker, the CLI and the corpus run all wrap exactly these):

```python
from ifc_boq.parse import parse_file                 # IFC path -> (ParsedModel dict, parser)
from ifc_boq.pipeline import get_boq                 # -> BoqResult dict
from ifc_boq.export_xlsx import export               # BoqResult + meta -> xlsx bytes

result = get_boq(parsed, rules, classifications=[(code_list, cmap), ...],
                 dictionaries=[global, company, project], resolution=settings,
                 decisions=[...], rule_library={id: rule_set},  # library only needed for patches
                 federation=settings,      # several models: parsed = [{id, parsed, ...}, ...]
                 progress=callback,        # stage progress for the worker
                 manual_items=[...])       # the BoQ's manual lines (F06)
```

Line edits arrive as decisions with ids `override:{lineKey}` (`overrides.from_decisions`); an edit
whose line no longer exists becomes an `orphan_override` question.

## Engine versus backend

The Java backend owns users, projects, storage and jobs. Everything that decides something is
engine code: plain functions over the contract types in `packages/types`, data in and data out,
no HTTP, no file paths, no storage. The engine may move to Java later, so keep it easy to
translate (no Python-only tricks where a plain loop would do). Formulas are evaluated only here
(`expr.py`); a rule editor previews through a `preview` job, never a second evaluator.

## Modules

| Module | Owns | Must not |
|---|---|---|
| `parse.py` | Reading IFC, geometry, verification checks; output = `ParsedModel` + mesh sidecar | Apply dictionaries or choose quantities |
| `geometry.py` | Mesh measurements (room surfaces, element sides, room contacts, shared volume), mesh repair, mesh sidecar format | Read IFC or decide anything |
| `names.py` | Dictionary resolution, extractors, term hierarchy | Know about rules |
| `measure.py` | Adoption policy: which number to trust per element | Know about rules |
| `rules.py` | Executing a rule set over measured elements | Measure geometry or read IFC |
| `classify.py` | Codes per line per system | Change quantities |
| `federation.py` | Combining several models' measured elements: storeys, same GlobalId, ownership, overlaps, aggregates, links across models (fillings, rooms, embedded) | Read files or know about rules |
| `overrides.py` | Line edits (quantity, text, unit, section, order, exclude) applied to the run's lines; `orphan_override` questions | Change how anything is measured |
| `templates.py` | Brace templates (`{thickness}`) in rule descriptions and classification item texts (P14) | |
| `trace_steps.py` | Structured steps of each line's quantity ("How it is calculated", EN-013) | |
| `pipeline.py` | Order of stages, coverage, questions, stats; `names_in_model` | Contain stage logic |
| `expr.py`, `log.py` | The safe expression evaluator; the calculation log | |
| `diff.py` | Change report between two runs and their model versions, by line key and GlobalId (F08) | |
| `preview.py` | Comparing a preset preview's lines with the current lines by key (F10) | |
| `export_xlsx.py`, `sheets/` | Excel: the BoQ workbook; `boq_import.py` (edits imported back from Excel), `diff_export.py` (change report workbook), `templates.py` (preset Excel templates, P24), `xlsx_guard.py` (every user workbook opens through it: zip-bomb caps before openpyxl reads anything) | |
| `codelist_import.py` | Code lists from CSV / TSV / Excel (read the table, then build codes from a column mapping) | |
| `presets.py`, `paths.py` | Loading, flattening and validating presets against the schemas; where files live (env overrides) | |
| `service.py`, `worker.py`, `worker_http.py`, `worker_queue.py`, `rpc.py`, `storage.py`, `cli.py`, `corpus.py`, `catalogue.py` | Wiring: preset ids to a run; the job contract (`parse`, `run`, `preview`, `diff`, `export_xlsx`, `import_boq_edits`); the HTTP transport (`POST /jobs/{kind}`, `POST /rpc/{op}`, `GET /health`); the Postgres queue consumer (`boqlet-worker`); quick calls (`check`, `names`, `codelist-read`, `codelist-build`, `expr-check`, `template-export`, `template-import`); file or S3 artifact storage; the terminal; the corpus run; the corpus catalogue | Contain engine logic |

Which transport runs where (local stack, pilot) is in [engine-worker.md](engine-worker.md).

## Stages

| # | Stage (log name) | Module | In | Out |
|---|---|---|---|---|
| 1 | parse | `parse.py` (+ `geometry.py`) | IFC file | `ParsedModel` + `geometry.glb` + `meshes.npz` (mesh sidecar), verification checks. Slow; cached by file hash. |
| 2 | names | `names.py` | raw names + dictionaries + name decisions | term per (field, raw text); extracted values |
| 3 | measure | `measure.py` | ParsedModel + resolver, per model | `MeasuredElement[]` with one adopted number per quantity and its provenance |
| 3b | match (federation) | `federation.py` | every model's measured elements + boxes (+ meshes), FederationSettings, scopes | one combined `MeasuredElement[]` linked across models, `ModelReport[]`, `overlap` and `duplicate_conflict` questions, warnings |
| 4 | match / quantity | `rules.py` `run_items` | elements + flattened rule set + decisions | item lines with traces |
| 5 | derived | `rules.py` `run_derived` | item lines | derived lines |
| 6 | manual | `rules.py` `run_manual` | rule set | manual lines |
| 7 | coverage | `pipeline.py` | matched / excluded / covered sets | `unmatched` questions |
| 8 | names that matter | `pipeline.py` | unresolved names + fields the rules reference | `unknown_name` questions (blocking only if needed) |
| 9 | classify | `classify.py` | lines + each (code list, map) + code decisions | codes per line per system; `unclassified` / conflict questions; warnings |
| 10 | decision, summary | `pipeline.py` | decisions, questions | answered questions removed, status, stats, sorted lines |

Lines are sorted by the first classification's code path, then by rule order, then description.

### 1. Parse (`parse.py`)

ifcopenshell reads the file; `ifcopenshell.geom` meshes every element with openings cut
(world coordinates, parallel iterator). Geometry is requested in file units and scaled with
the parser's own unit factor: the kernel can miss a unit assignment and return millimetres as
metres (ISO sample `wall-with-opening-and-window`: a 6 m2 wall came out as 5,000,000,000 m2).
Each mesh goes into trimesh for volume, area, bounding box and watertightness; inconsistent face
winding is repaired before measuring (this is what fixed the Duplex party wall: 433 m3 raw,
25.83 m3 repaired). `closed` is true when the mesh is watertight, or when its only open edges
are T-junctions (every boundary loop has ~zero vector area), which tessellated exports produce;
an open pipe end or a missing face is a loop with real area. The oriented bounding box
(`obbExtents`, `obbAxes`; numpy only: the better of the minimum-area plan rectangle with the
vertical extent and the principal axes) is taken on the largest disjoint body (`bodyCount`),
so measuring does not depend on world axes. Classification references on a type are inherited
by its occurrences. Pairwise solid intersections
(trimesh booleans on the manifold3d engine, for walls, slabs, footings, beams, columns,
members, coverings, plates, piles, roofs; a sweep along x so only pairs whose boxes overlap are
intersected; minimum 0.001 m3) catch double counting, and each element keeps what it shares with
others (`intersections`), which measure turns into `embedded`. The sweep is one-dimensional: a
tall, narrow model still compares many pairs; a full spatial index is for large models. Material,
type, profile, layer set, property and quantity set extraction keeps everything raw. Checks are
grouped and summarised (`CheckCode`, see 04). The parser makes no decisions.

Faces and rooms (`faces_and_rooms`): for walls, slabs, coverings and plates the mesh faces are split by
direction along the oriented box's thin axis into side a (along the axis; up for slabs) and side b;
for each room solid whose surface lies on a side within 0.1 m and faces it, the contact area is the
room's triangles clipped to the element's extent (`contacts`). Room solids get floor, ceiling and wall
areas, floor outline perimeter and height (`room`). Footings get the area of their faces standing up and the part of it
against or inside another closed footing, wall, slab, column, pile or beam (`verticalFaces`: points on a fixed
lattice 0.2 m apart, 2 cm outside the face, tested by winding number). Roofs with a closed body get the true and plan
area of their faces looking up (`upFaces`, normal z > 0.05). Geometry only; decisions are in measure.

The mesh measurements live in `geometry.py` (room surfaces, element sides, side contacts, shared
volume), so federation can run the same code across files. Every mesh is also saved, in world
coordinates and float64, as the **mesh sidecar** `meshes.npz` beside `parsed.json` (`save_meshes` /
`load_meshes`); the ParsedModel carries measurements, not meshes. `get_boq` takes the sidecar per
model (`meshes`); without it, work that needs two models' meshes together is skipped and logged.

Run standalone: `python -m ifc_boq.parse model.ifc out_dir [--schema ...] [--no-overlaps]`.

### 2. Names (`names.py`)

`Resolver` resolves raw text per field (material, layer_material, type_name, name, object_type,
ifc_class, predefined_type, system, space_name, props.*) to a **term**. Order: decision layer
(this run's answers to `unknown_name` questions) -> project -> company -> global; within a layer
exact -> startsWith -> regex -> contains. Matching folds case and accents (`đ` -> `dj`). Entries
can carry a `when` condition over the element context (so "CT" can mean different things on
ceilings and slabs). Dictionary regexes are ECMAScript syntax; `py_regex` converts named groups.
Extractors pull values out of names (Revit "Family:Type:Id", thicknesses like "25 cm",
strength classes, steel profiles, pipe sizes). Results are cached per (field, raw, context).
`under(term, root)` answers term-hierarchy questions for rules and maps. Details in 07.

### 3. Measure (`measure.py`): the adoption policy

This is where the engine decides **which number to trust**. It never looks at rules. Constants
live at the top of the file; the list of reported-quantity sources is data
(`data/quantity_sources.json`: IFC `Qto_*BaseQuantities` first, then their generic `BaseQuantities` twins, then
authoring-tool sets such as `PSet_Revit_Dimensions`; ArchiCAD entries are placeholders that
still need checking against a real ArchiCAD export).

| Quantity | Policy (v0) | Why |
|---|---|---|
| volume | reported if present, else geometry, but only from a **closed** mesh (watertight, or closed with T-junctions). If both exist and differ by more than 1%, the reported value is still used and a warning is logged; beyond `contradictionWarnPct` (resolution settings, default 10%) a `contradiction` question asks per class and type whether to use the geometry; while unanswered the geometry is used when the stated value is outside 0.5–2× a closed mesh's (D73). **Unit errors** (D71): a stated volume, area or length within 2% of 10^±3 or 10^±6 times a closed mesh's value (area: a clear plate's mean side; length: the oriented box) is an exporter unit error: the geometry is used, the question recommends it, the element records `unit_scale` and its lines carry a note | Reported values are join-aware; geometry double counts at junctions (Duplex party wall stub: geometry +42%). Tessellated exports leave T-junctions; their volume is exact. S09 states every slab volume ×1000 |
| thickness | material layer set total, else reported, else smallest extent of the **oriented** bounding box (of the largest body). A stated thickness more than `contradictionWarnPct` (and 5 mm) away from the geometry's (volume / mean side area, clear plates only) raises a `contradiction` question. A horizontal plate's stated quantity (`Qto_*.Width`, not its layer set) gives way to the geometry while unanswered (D72) | World-axis extents gave a rotated bridge wall a thickness of 10.39 m. Duplex party wall: layers 0.55 m, geometry 0.46-0.50 m |
| wall area | the mean of its two measured faces (openings cut by the parser) when its mesh is a clear plate standing up whose oriented box is at most 1.5x its thickness thick; else net volume / thickness (curved or bent walls, open meshes, no sides); else reported area. Volume / thickness is the cross-check: more than 10% off raises the thickness `contradiction` | Revit's Area disagreed with Volume on 7 Duplex walls; volume / thickness understated walls whose body is not a full prism: Duplex party walls 71.67 vs faces 78.83 m2, S07 partitions -11 to -16 % (A-09) |
| other areas | reported, else net volume / thickness (but never from a reported volume the geometry contradicts: then the mean side area of a clear plate), else for an open surface model (road markings) the one-sided mesh area. A net area larger than the gross one of the same set is impossible and skipped. A reported area more than 10% from a clear plate's mean side area (plus its openings for a `Gross*` source) raises an area `contradiction`; outside 0.5–2× the geometry is used while unanswered (D72) | S09: the area of a slab whose stated volume is ×1000 came out ×1000 (QS-001). Revit 2021 IFC4 writes the whole surface as `NetArea`: every S07/S08 slab ×2.2–2.5 (QS-003) |
| gross area / volume | net + the openings hosted by the element | Gives rules both starting points |
| length | reported (a Revit member's Cut Length before its analytical Length, A-17), else the oriented box: columns and piles along the most vertical axis, other linear elements the longest extent, others the longest horizontal extent | World axes measured rotated girders 12% short and gave columns a plan width |
| vertical face area | footings: the faces standing up less the part against another solid (parse `verticalFaces`), else 2 x (length + width) x height | Formwork to footings was 2 x length x height: S04 ring footing 3.72 vs 15.15 m2, strip ends omitted (A-10) |
| roof without layers | an IfcRoof with its own closed body and no layer set: area = the true area of the faces looking up (parse `upFaces`), footprint = their plan projection, thickness = volume / area | S09's main roof (closed Brep, plain material) had no area at all (CAS-018, A-15) |
| perimeter | reported, else for a closed slab-like prism P = (S - 2V/t) / t (includes opening edges) | Slab edge formwork had no perimeter outside Revit |
| perimeter outer / openings | `perimeter_openings` = 2 x (width + height) of each opening through the element (plan size; recesses left out), `perimeter_outer` = perimeter less that; a reported `Perimeter` (exporter-dependent) is taken as the total, noted; a perimeter not longer than its openings' edges is taken as the outer edge | The edge formwork choices "outer edge" and "outer edge and the edges of openings" both used the total, so the second counted the openings twice (A-13) |
| aggregates | an element without its own body (IfcRoof made of slabs, IfcElementAssembly) takes the sum of its parts' adopted volumes (only if every part with a body has one) and of its planar parts' areas, nested assemblies bottom up | The certification roof had no geometry of its own |
| class | IFC2x3 generic distribution occurrences take the class their type names (IfcFlowSegment + IfcDuctSegmentType -> IfcDuctSegment); `ifc_class_raw` keeps the original | IFC2x3 has no IfcDuctSegment; rules and IFC4 files use the specific class |
| family | nearest class listed in `families.ts`, walking the schema's supertypes (IfcAirTerminal -> IfcFlowTerminal) | |
| discipline | "mep" for distribution elements, else the model's guess | MEP items in an architecture or infrastructure file were never counted |
| height | door/window OverallHeight, else reported, else vertical extent | |
| faces | walls, slabs, coverings, plates: from geometry (parse `sides`, `contacts`): per side, one face per room lying on it (the room's contact area; openings shared in proportion) plus the part no room covers (a sliver under 5 % is spread over the room faces, so a side's faces add up to the side, A-11). Each face names its outermost material layer (`layer_material`): IFC stacks the layer set from the reference line along its usage direction, so the first layer is on the face looking against it (placement axes and `DirectionSense`; unknown: the last layer is put on side a, noted). Walls: sides a / b; slabs: top / bottom. Without geometry: each side = main area | `side_a`, `side_b`, `larger`, `smaller`, `mean`, `both` use the real wall sides; slab `top` / `bottom` stay the adopted main area (a slab mesh's top includes the area under walls) |
| rooms (IfcSpace) | measured elements of family `space`: floor, ceiling and wall area, perimeter, height from `Qto_SpaceBaseQuantities`, else the room solid; net wall area = wall area less the openings in bounding elements near the room; skirting = perimeter less door widths; room type from the dictionary (`space_name`) | Revit's room `Area` is not used: it follows a Revit setting and was ~9% above the room solids on the Duplex (whose solids match Revit's own volumes) |
| layers | one per material layer: area = main net area, volume = area x thickness, material resolved to a term | |
| embedded | a planar element sharing solid volume with a linear one (column through a slab, beam in a wall; parse `intersections`, or across models in federation): `embedded[]` with the shared volume and volume / thickness as area. A room shares volume with the columns standing in it (parse: room solid x column solid): area = volume / room height. Elements the modeller cut out share nothing | `embedded` deductions; Duplex: beams through six exterior walls |
| openings | door / window by filling; `recess` when the IFC marks it (RECESS, or ObjectType "Recess"), else void. Recesses stay out of gross / net areas (an area derived from volume adds the recess volume back) and out of room openings | `recesses` deductions |
| steel mass per metre | parsed from metric W-shape names (W310X60 -> 60 kg/m). Other section families (IPE, HEA...) need a section table, not bundled; rules fall back to volume x density | Geometry was 3.5-4.7% over Revit on Duplex beams |
| main material | thickest non-air layer, resolved to a term | |
| status | Revit phasing (Phase Created / Demolished), else the IFC `Status` of the common property set (NEW, EXISTING, DEMOLISH, TEMPORARY), else new | Rule-set `scope` (renovation), `demolition` items |
| building (after federation) | `building_measures`: the IFC building's `Qto_BuildingBaseQuantities`, else derived from all elements (floor slab plan areas per storey, storey heights, room areas and volumes, element solid extents) | `building.*` in formulas; `BoqResult.building` |
| family_name | from the Revit "Family:Type:Id" extractor | Lets rules split windows by family |

Every adopted value records its provenance (`reported`, `geometry`, `derived`, `user`), and the
measure stage logs one detail line per element explaining the choice.

### 3b. Federation (`federation.py`)

`get_boq` takes one ParsedModel or a list `[{id, parsed, meshes?, discipline?, scope?}]`; one model is a
federation of one (D43, D44, design in 10). Each model is measured on its own (cached parse,
model id and discipline on every element), then `combine()` builds one element set before rules:

| Step | What happens |
|---|---|
| storeys | levels within `storeyTolerance` across models are one level; an architecture model's name wins, else the most common; a name used at two levels is a warning |
| coordinates | models whose element boxes do not overlap at all: a warning (shared coordinates assumed) |
| same GlobalId | kept once: the copy with a measurable body, then the copy of the discipline that owns the object judged on every copy (a wall one copy calls load-bearing concrete is structure's), then the one its own model owns, then the first (D86). Copies that differ in class, type, material, or thickness / volume / area / length beyond `contradictionWarnPct` raise `duplicate_conflict:{guid}` with every copy's values (blocking beyond `contradictionBlockPct`); an aggregate compares names only, its parts are compared on their own. Parts of a dropped copy are measured on their own (the structural roof's girders under the architectural roof's GlobalId) |
| ownership | taken if the model's discipline owns it (`presets/settings/federation.json`: `owns` selectors, or `rest`) or `scope.include` selects it; `scope.exclude` always drops it. Not owned: left to the owning model if it has an element of the same IFC class that overlaps it by `duplicateOverlap`, else taken here with a `federation_hole` warning (none for a part of an aggregate its own model owns: a curtain wall's mullions, a stair's stringers). A discipline not in the settings owns everything |
| overlaps | taken elements of one IFC class from different models that overlap: one `overlap` question per model pair and class, id `overlap:{a}\|{b}:{IfcClass}` with model keys = discipline (or discipline/file name). Answer: the model to keep, or `both`. Unanswered: both kept, `federation_overlap` warning, and the question blocks unless `overlapBlocking` is false (D87) |
| aggregates | an aggregate whose parts were left to another model, excluded or dropped loses them, and its rolled-up volume and area are summed again from the parts kept; with no part left it is left to the other models |
| fillings | a door or window whose host is not taken (left to the structural model, or never hosted) fills the unfilled opening of another model's taken element whose box holds it (half of the smaller box); the opening becomes a door / window opening. No opening in its place: `federation_unhosted` warning |
| rooms | rooms of one model lying on walls and slabs of another (same contact test as parse): those elements get faces with the room; every room's `bounded_by`, openings, net wall area and skirting are recomputed from the elements actually taken. Needs meshes |
| embedded | columns and beams of one model sharing solid volume with walls and slabs of another become `embedded` there (with `model`); embedded elements not taken are removed. Needs meshes |

"Overlap" is the share of the smaller solid inside the other, from the meshes when both models have
the sidecar and both solids are closed (crossing diagonal braces are not duplicates), else the share
of the smaller bounding box. The log says how many pairs each test decided.

The result lists every model in `BoqResult.models` (taken, left to others, duplicates, excluded,
taken without owner); trace elements carry their model id. The selector evaluator is shared with
the rules (`rules.select`). Settings are passed in by the caller; the engine never loads presets.

### 4-6. Rules (`rules.py`)

`flatten(target, library)` resolves an `extends` chain: params merge by name, items / derived /
manual override by id, `remove` drops ids; the chain is recorded (`meta.chain` on the
snapshot). `integrity(rules)` reports problems independent of any model (e.g. a derived rule
whose source item was removed). `referenced_fields` lists which element fields the rules and
maps read (used to decide which unknown names matter).

`RuleEngine.run_items()`:

1. Applies `unmatched` decisions: elements answered "exclude" are excluded; elements assigned
   a rule id are forced into that rule.
2. Pass 1: every rule's selector against every element.
3. Pass 2, per enabled rule: skip excluded elements; skip **aggregate parts** whose parent is
   measured by an enabled rule (it takes the parent, `partFilter` included, and gets a value
   for it) unless the rule says `parts: "include"`; apply `partFilter`; add forced elements;
   record `claims`. A parent that rules take but cannot measure (a roof with no body and no
   planar parts) is measured **through its parts** instead of becoming a flagged line that
   hides them; the log says so and coverage counts it as covered. An aggregate whose parts are
   all measured or excluded is covered too.
4. For each element, `parts_of` applies the breakdown (element, layer, face, material, child),
   then `add_part` evaluates the `QuantitySpec`, handles missing values (`onMissing`: flag,
   skip, ask -> `missing_data` question, `{default}`; a numeric decision for
   `missing:{rule}:{guid}` supplies the value), applies `factor`, element `minimum`, unit
   conversion from SI, element rounding, computes line keys and bands, and appends to the line
   with a trace entry and a log detail.
5. Elements matched by a disabled rule are counted as excluded. Two or more rules claiming the
   same claim name on elements raise one `double_claim` question per claim and set of rules
   (before any line is made); the answer names the rule that keeps them, or "both".
6. After the lines (and a person's line edits), an element in the item lines of two or more rules
   measuring it in the same family (count, length, area, volume, mass, from the line unit), where a
   pair of those rules does not both declare `claims`, gives one non-blocking `double_count` warning
   per family and set of rules (BR-13, D88): rules that both declare claims say what each measures;
   derived and manual lines and excluded lines are not counted.

A line that has a quantity but needs a look gets `toConfirm` (A-05): `{measured, elements}` when some of its
elements had no value, `questions` when an element's quantity rests on an open `contradiction` (measure marks
such elements `contradictions`; an aggregate measured from its parts inherits its parts'). A derived line
follows its source lines; a person's quantity edit confirms a line. `stats.flaggedLines` counts these lines
with the lines without a quantity; the sheet shows them "To confirm" and the Excel in yellow with the reason.

Each trace element names the **decisions** that decided how it was measured (A-06): the `contradiction`
answers measure applied (`MeasuredElement.decisions`) and a `missing_data` value, with `by` / `at` when the job
input's `Decision` carries `decidedBy` / `decidedAt` (Java sends the author's name and the time).
`stats.decisionsApplied` counts every decision the run used (`answeredQuestionIds`) plus the edited lines.

`finalize_lines()` flags lines where no element had a value, applies line minimum and line
rounding, records the most common value of mixable fields (material, element_type, storey,
ifc_class, is_external...) for classification and notes which are mixed, and sets the line's
location (one storey, or the list).

`run_derived()`: for each enabled derived rule and each source line of its `from` items, either
per **line** (`src.qty`, `src.<field>`, `keys`) or per **element** (`src.<measured field>`),
filtered by `where`, evaluates `quantity`, applies `factor` and `onMissing`. Grouping:
`lineKey` absent = one derived line per source line; present = group by those fields; `[]` = a
single line. Derived lines remember their `sourceLine` (used by `fromSource` codes).

`run_manual()`: one line per enabled manual item; no quantity = flagged line ("quantity to be
entered"); amounts recorded in notes.

`describe_spec` writes the human-readable formula shown in traces, e.g.
`IF thickness >= p.masonry_volume_from THEN volume (gross) - openings[all] ELSE area (main, gross) - openings[all]`.

## The expression language (`expr.py`)

One small, safe language used by rules (`formula`, `when.if`, `where`, `partFilter`,
`lineKey` expressions, template placeholders), dictionaries (`when`) and classification maps
(`where`). Parsed to an AST once (cached), evaluated by a tree walker. No `eval`.

```
literals     12  0.5  "text"  true  false  null
operators    + - * /  ( )  = != > >= < <=  AND OR NOT
functions    IF(c,a,b) MIN(a,..) MAX(a,..) ROUND(x,step) CEIL(x,step) FLOOR(x,step)
             ABS(x) SQRT(x) PI() COALESCE(a,..) UNDER(term,"root") CONTAINS(text,"x") LOWER(x)
variables    net_area, thickness, src.length, p.opening_threshold, keys.type_name,
             props["Pset_WallCommon.FireRating"]
aggregates   SUM | COUNT | AVG | MIN | MAX over a list, optional WHERE per item:
             SUM(openings.area WHERE area > p.min_opening)
             COUNT(openings WHERE kind = "door")
             SUM(src.layers.area WHERE UNDER(material, "board.plasterboard"))
collections  openings, layers, faces, children (and src.* versions in derived rules)
```

Semantics: unknown variables are `null`; arithmetic with `null` gives `null`; comparisons with
`null` are false except `= null` / `!= null`; AND / OR treat `null` as false. Inside `WHERE`,
the item's fields shadow the outer context (`area` is the opening's area) while `p.x` still
reaches parameters. `explain()` returns the expression with values substituted
(`2 * src.length * src.height` -> `2 * 17.383 * 0.3 = 10.43`); that text is what users see in
traces and the log.

To add a function: add it to `default_functions()` in `expr.py`, document it in the `Expr`
comment in `packages/types/src/rules.ts` and here, add a case to `engine/tests/test_expr.py`.

### Plausibility warnings (`plausibility.py`)

After the rules, the pipeline checks what an element is and how big it is (A-07). These are `implausible`
warnings: they never change a number and never block. Per element type: an `IfcSlab` thicker than its plan width
(a pile exported as a slab) or than `plausibility.maxSlabThickness` (1.5 m), and a slab whose name or type has one
of `plausibility.slabNameWords` as a whole word (default: pile, pad, cap in several languages). Per line: a line of
floor slabs with more m² than footprint × storeys. Per storey: floor slabs over `storeySlabAreaFactor` (3) × the
footprint. The settings are the resolution settings' `plausibility` block. In any model (A-08), a door or window
that fills no opening and is not part of an aggregate raises `unhosted_opening`, naming the nearest wall by
bounding box: no wall is reduced by it (federation's `federation_unhosted` covers a host left to another model).

## Questions and decisions

| Kind | Raised by | Id | Blocking | Answer type | Effect of the answer |
|---|---|---|---|---|---|
| `unknown_name` | pipeline (names nobody resolved) | `name:{field}:{raw}` | only if `unresolved = "ask"` and the field is referenced by the rules or maps, and `askFor` allows it | term (filtered by category) | becomes a decision-layer dictionary entry; the name resolves on every later run |
| `missing_data` | rules, `onMissing: "ask"` | `missing:{ruleId}:{guid}` | yes | number (in the line unit) | value used for that element, marked user-supplied |
| `unmatched` | pipeline coverage | `unmatched:{ifc_class}:{type_name}` | no | rule id or `exclude` | elements forced into that rule, or excluded |
| `unclassified` | classify, `onUnmapped: "ask"` | `unclassified:{system}:{lineKey}` | no | code from that list | code applied with source `decision` |
| `classification_conflict` | classify, `onConflict: "ask"` | `classconflict:{system}:{lineKey}` | no | code | (answer currently informative; first rule still wins) |
| `double_claim` | rules, two or more rules claim the same thing (`claims`) on elements | `double_claim:{claim}:{rule ids sorted, \|-joined}` | no | choice: a rule id, or `both` | only that rule measures those elements; `both` keeps all (unanswered: all kept, `double_claim` warning) |
| `contradiction` | measure, reported volume, area (clear plates) or stated thickness vs geometry beyond `contradictionWarnPct` (default 10%); a stated volume, area or length that is a unit error (D71) | `contradiction:{volume\|thickness\|area\|length}:{ifc_class}:{type_name}` | when an element differs by more than `contradictionBlockPct` (default 50%), unless it is a unit error (D73) | choice: `reported` or `geometry`; `suggestion` (and the recommended option) is what is used unanswered: the geometry for a unit error, an implausible area (outside 0.5–2×) or a horizontal plate's stated thickness quantity (D72), a volume or thickness outside 0.5–2× (D73), else the stated value | the geometry's value is adopted (provenance `geometry`) for those elements, or the stated one confirmed |
| `overlap` | federation, same IFC class from two models in one place | `overlap:{model a}\|{model b}:{ifc_class}` | yes, unless the federation settings' `overlapBlocking` is false (D87) | choice: a model key, or `both` | elements of the other model dropped |
| `duplicate_conflict` | federation, copies of one GlobalId in several models that differ in class, type, material, or thickness / volume / area / length beyond `contradictionWarnPct` (D86) | `duplicate_conflict:{guid}` | when a quantity differs by more than `contradictionBlockPct` | choice: a model key (the copy to measure); `suggestion` = the copy used unanswered (the owning discipline's) | that model's copy is measured; the trace names the decision |
| `orphan_override` | overrides, a line edit whose line is not in this run | `orphan:{lineKey}` | no | choice: `dismiss` | the edit is dropped (BR-09) |

Ids are built from content so the same situation produces the same id on every run and every
new model version; that is what lets stored decisions re-apply (D19). A decision with
`answer: null` dismisses a question. Status is `needs_input` only while a blocking question is
open (D20).

## Calculation log (`log.py`)

`CalcLog` collects ordered entries `{seq, stage, level, message, ruleId?, lineKey?, guid?, data?}`.
Levels: `info` (one per step or line), `detail` (one per element or name), `warning`.
Stages: parse, names, measure, match, quantity, derived, manual, classify, decision, summary.
Write messages for a user checking a number, not as a debug dump: say what was chosen and why,
with the numbers. The UI filters by stage, line and text; Excel gets a Log sheet.

## Excel export (`export_xlsx.py`)

| Sheet | Content |
|---|---|
| Cover | (when project, BoQ, version label or watermark are given) project, bill, version, status (WORKING for the working version), model, grouping, who saved it and when, locale, number format, the "Made with boqlet" watermark |
| BoQ | Priced-bill layout grouped by the first classification: Ref, Description, Unit, Qty, Rate (yellow input), Amount (formula), subtotals per group and a total, all live formulas. Flagged lines highlighted. |
| Excluded lines | (when any) lines excluded by an edit, with the reason |
| Calculation | Every line with its formula, parameters and each element's contribution |
| Lines | Flat table of all lines with codes in every system (for filters and pivots) |
| Log | The calculation log |
| Questions | Open questions, warnings, verification checks |
| Inputs | Model, rule set chain and parameter values, dictionaries, classifications, decisions |

With a BoQ id the BoQ sheet also carries a hidden line-key column, so an edited workbook can be
imported back (`sheets/boq_import.py`, job `import_boq_edits`, F12). Formulas were verified to
recalculate with zero errors in LibreOffice (PoC era); the product's workbooks are checked with
openpyxl only, opening them in Excel and LibreOffice by hand is still to do
([known limitations](../product/known-limitations.md)).

## Command line (`cli.py`)

```bash
npm run boq -- model.ifc [more.ifc ...] [--disciplines architecture structure ...] \
   [--rules as-modelled] [--dict global-seed acme-company] \
   [--class acme-cost-codes demo-trades] [--decisions answers.json] \
   [--out boq.xlsx] [--json result.json] [--save-parsed parsed.json] [--quiet]
```

Accepts one or more IFC files, or `parsed.json` files saved earlier (much faster; `meshes.npz`
beside them). Several files are federated into one BoQ; `--disciplines` gives each file's
discipline in order. Preset arguments take ids or paths; the defaults are `as-modelled`,
`global-seed` and `acme-cost-codes` (`presets.DEFAULTS`). Prints the BoQ table and a summary;
exits with code 2 when the result needs input.

`npm run corpus -- <folder> [--rules id] [--out dir] [--no-overlaps]` (`corpus.py`) runs every
IFC under a folder, validates both outputs against the schemas and prints one row per file
(measured, unmatched, excluded, flagged, blocking questions, parse checks). With `--out` it
keeps parsed.json, result.json and summary.json per file to compare runs after an engine change.

## Tests (`engine/tests`)

| File | Covers |
|---|---|
| `test_expr.py` | Values of many expressions (operators, null semantics, functions, aggregates with WHERE, an opening-deduction formula), `explain()` substitution, proof that Python `eval` is never reachable |
| `test_presets.py` | Schemas exist; every preset loads and validates; every rule set flattens with a clean integrity check; maps only emit codes that exist; dictionary entries point to defined terms |
| `test_names.py` | 26 messy multilingual names (`messy_names.json`) resolve to the right terms, including "CT" meaning different things on coverings and slabs and staying unknown on walls; the decision layer wins over dictionaries; extractors |
| `test_certification_samples.py` | buildingSMART samples and a hand-written IFC: unit scaling (mm the kernel misses, inch), one scene giving the same numbers in IFC2x3 / IFC4 / IFC4.3, walls agree with `Qto_WallBaseQuantities`, roof from its slabs, parent measured through its parts, T-junction volumes trusted and real holes rejected, rotated wall / sloped beam / rotated slab perimeter / two-body wall from the oriented box, IFC2x3 MEP class from type, discipline guess, marker objects excluded, library-style material names, type-level classification |
| `test_duplex.py` | Acceptance: as-modelled reproduces the hand-made BoQ (`HAND_BOQ`, counts); every line explained; every line coded; party wall internal by dictionary type; slot change changes numbers (demo-tweaked); custom rules and classification (demo-custom + demo-trades); unmatched decision assigns a rule; other presets run; unknown material blocks until answered; contract tests for BoqResult and ParsedModel |
| `test_federation.py`, `test_federation_links.py` | Several models in one run: ownership, scopes, same GlobalId, overlap questions and answers; doors to another model's openings, rooms to walls, columns through slabs, contradiction and double-claim questions |
| `test_faces_rooms.py` | Wall sides, faces per room, rooms with net wall area and skirting |
| `test_measurement_defaults.py` | Review WP-A3: walls by their faces (notched, prismatic, curved and open fallbacks), footings' vertical faces (pad, ring, strip against its neighbours), paint per face by the opening rule, reveals once per face, slab perimeters outer and openings |
| `test_scope_recess_building.py` | Model scopes, recess deductions, derived `building.*` values |
| `test_overrides.py` | Line edits applied to a run; `orphan_override` |
| `test_diff.py` | Change report on the Duplex revision; 40k lines in under 5 s |
| `test_item_texts.py`, `test_preset_templates.py` | Item texts on codes (P14); preset Excel templates round trip (P24) |
| `test_codelist_import.py` | Code lists from spreadsheets |
| `test_mesh_repair.py`, `test_model_summary.py` | numpy mesh repair; the model summary the worker writes |
| `test_worker.py`, `test_worker_logging.py` | The HTTP worker on the Duplex; unsafe storage keys refused; worker JSON logs |

`conftest.py` parses the Duplex once per session (about 5 s). `npm run test:engine` runs them
all (211 collected); how they fit the other suites: [docs/testing/README.md](../testing/README.md).

## Measured on the Duplex (2.4 MB, 218 elements)

| Step | Time / result |
|---|---|
| First parse (geometry, verification) | about 5 s, then cached by file hash |
| Each run (names, measure, rules, classify, log) | under 0.2 s |
| Output (as modelled + ACME codes) | 41 lines (3 flagged manual items); 150 of 218 elements measured, 7 covered by their parent (roof slab, stair flights), 61 furniture items excluded because the furniture rule is disabled by a slot; 0 unmatched; about 620 log entries |

Performance targets for larger models and what was measured: [nfr.md](nfr.md).

## Extending: where things go

| You want to | Change |
|---|---|
| Support a new authoring tool's quantity set | `data/quantity_sources.json` (data, not code) |
| Fix an exporter quirk (bad geometry, odd property) | `parse.py` (repair or check) or `measure.py` (adoption), plus a test with a fixture file |
| Add a measured field | `measured.ts` + `MeasuredField`, `npm run codegen`, compute it in `measure.py` |
| Add a quantity kind, surface, deduction mode or breakdown | `rules.ts`, codegen, `rules.py` (`quantity`, `surface_values`, `deductions`, `parts_of`), `describe_spec`, [rules-language.md](rules-language.md) |
| Add a question kind | `engine.ts` `QuestionKind`, raise it with a deterministic id and a message `code`, apply its decision, add the answer control in `apps/app/src/features/questions/answer-control.tsx` and the message to the app's `engine` catalogue (F15) |
| Add a job type or a quick call | `worker.py` (`JOB_TYPES`) or `rpc.py` (`OPERATIONS`), the contract in [engine-worker.md](engine-worker.md), and the Java caller |
| Add an export format | a new module beside `export_xlsx.py` taking `BoqResult` |
| Change which number is trusted | `measure.py` only. Never in a rule set. |

Never special-case a preset id in Python. If a rule set cannot express something, extend the
rule type.
