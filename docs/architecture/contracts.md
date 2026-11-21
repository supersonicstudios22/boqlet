# Types and contracts

`packages/types/src` is the single source of truth for every shape that crosses a boundary:
between presets and the engine, between the engine and the UI, and through the worker's job
documents between the engine and the Java backend. Each file opens with a long header comment explaining its design; read those
alongside this page.

## Files

| File | Main exports | Role |
|---|---|---|
| `rules.ts` | `OurRuleType = RuleSet \| RuleSetPatch`, `Param`, `Value<T>`, `Selector`, `QuantitySpec`, `DeductionRule`, `ItemRule`, `DerivedRule`, `ManualItem`, `Breakdown`, `OnMissing`, `Band`, `Rounding` | Input (2): the universal rule set. See `docs/architecture/rules-language.md`. |
| `measured.ts` | `MeasuredElement`, `MeasuredField`, `Opening`, `Layer`, `Face`, `Unit`, `Provenance` | The engine's contract with rules: everything measured per element. Rules can only use these fields. |
| `families.ts` | `ElementFamily`, `IFC_FAMILIES`, `FAMILY_INFO` | Every IFC2x3 / IFC4 / IFC4.3 element class mapped to one of 8 measurement families, with the quantity kinds that make sense for each. |
| `parsed.ts` | `ParsedModel`, `ParsedElement`, `Header`, `SpatialNode`, `Catalogues`, `Relationship`, `Check`, `CheckCode` | Input (1) after parsing: the reusable JSON for one IFC version. |
| `dictionary.ts` | `Dictionary`, `Term`, `DictionaryEntry`, `Extractor`, `ResolutionSettings`, `Resolution`, `DictionaryInput` | Input (4). See `docs/architecture/dictionaries-and-classification.md`. |
| `classification.ts` | `CodeList`, `Code`, `ClassificationMap`, `MapRule`, `LineMatch`, `CodeTarget`, `LineCode`, `ClassificationInput` | Input (3). |
| `engine.ts` | `getBoq` (declaration), `ModelInput`, `Decision`, `BoqLine`, `LineSource`, `Question`, `QuestionKind`, `AnswerType`, `Warning`, `LogEntry`, `LogStage`, `BoqResult` | The engine's outside view and its output. |
| `diff.ts` | `RunDiff`, `LineChange`, `Change`, `ChangeCause` | The change report between two runs (`diff.py`, F08). |
| `messages.ts` | `QuestionCode`, `WarningCode`, … | Stable codes for engine messages; the app renders them from its `engine` catalogue, the English text is the fallback (F15). |
| `api.ts` | `ModelSummary`, `SceneIndex`, `RunRequest`, `NamesRequest`/`NamesResponse`, `TableReadResponse`, `CodeListBuildRequest`/`Response`, `CheckPresetRequest`/`Response`, and the proof of concept's leftovers (`PresetsResponse`, `RunResponse`, `SavePresetRequest`, `ApiError`) | Shapes the engine reports about models and runs. The product's HTTP contract is `packages/api/openapi.yaml`, whose schemas mirror several of these. |
| `index.ts` | re-exports everything | Import as `@ifc-boq/types`. |

The package has no build step: `exports` points at `src/index.ts`, and the app compiles it
directly (Next.js and `tsc`).

## Generated artefacts

`npm run codegen` (script `packages/types/scripts/codegen.ts`, using ts-json-schema-generator)
writes:

| Output | From type | Used by |
|---|---|---|
| `schema/rule-set.schema.json` | `OurRuleType` | `presets.py` validates every rule set on load; the worker validates each job's rule sets |
| `schema/manual-item.schema.json` | `ManualItem` | the worker validates a run's manual lines |
| `schema/parsed-model.schema.json` | `ParsedModel` | the worker validates every parse output; contract test |
| `schema/measured-element.schema.json` | `MeasuredElement` | `presets.py` (the line fields item-text templates may reference) |
| `schema/dictionary.schema.json` | `Dictionary` | `presets.py` |
| `schema/resolution-settings.schema.json` | `ResolutionSettings` | `presets.py` |
| `schema/codelist.schema.json` | `CodeList` | `presets.py`, `import_codelist.py` |
| `schema/classification-map.schema.json` | `ClassificationMap` | `presets.py` |
| `schema/boq-result.schema.json` | `BoqResult` | the worker validates every run result; contract test |
| `schema/run-diff.schema.json` | `RunDiff` | `test_diff.py` |
| `schema/decision.schema.json` | `Decision` | the worker validates a run's decisions |
| `schema/federation-settings.schema.json` | `FederationSettings` | the worker, `presets.py` |
| `schema/run-request.schema.json` | `RunRequest` | the shape `service.py` takes (preset ids), from the proof of concept's run request; no validator reads it today |
| `engine/ifc_boq/data/families.json` | `IFC_FAMILIES`, `FAMILY_INFO` | `measure.py` (family per IFC class) |

Workflow for any shape change:

1. Edit the type in `packages/types/src`.
2. `npm run codegen`.
3. Update the engine (Python) and, if affected, presets and the UI.
4. `npm run test`. The two contract tests (`test_result_matches_the_typescript_contract`,
   `test_parsed_model_matches_the_typescript_contract`) fail if the engine's output and the
   types disagree; `test_presets.py` fails if a preset no longer validates.

Never hand-edit files in `schema/`. The Java backend does not generate classes from these schemas:
its HTTP DTOs are generated from `packages/api/openapi.yaml` (openapi-generator, `spring`,
interfaces only, in the Maven build), and engine documents (rule sets, results, parsed models)
pass through Java as JSON (`JsonNode`), validated by the engine.

## The data layers

```
IFC file
  │  parse.py (slow, once per file content; cached by sha256)
  ▼
ParsedModel           faithful snapshot: no dictionary, no adopted quantities, no decisions
  │  names.py + measure.py (+ dictionaries, + name decisions)          fast
  ▼
MeasuredElement[]     names resolved to terms, one number adopted per quantity, provenance kept
  │  rules.py (+ rule set, + rule decisions)                          fast
  ▼
BoqLine[]             quantity, unit, description, trace, location, tags
  │  classify.py (+ code lists and maps, + code decisions)            fast
  ▼
BoqResult             lines with codes, questions, warnings, checks, log, stats, rule-set snapshot
```

### ParsedModel (`parsed.ts`)

One JSON per IFC version. Conventions: ids are IFC GlobalIds wherever the file has them
(stable across versions, used to match elements between revisions); catalogue entries without
one get deterministic ids (`mat:<step id>`, `mls:...`, `prf:...`, `cls:...`); all lengths,
areas and volumes converted to SI with the original unit kept in `header.units`; world
coordinates as in the file (federation alignment is a separate, later step); meshes are not in
the JSON but in `geometry.glb` (one node per GlobalId, for viewers) and the mesh sidecar `meshes.npz`
(float64, for the engine's work across models; `engine/ifc_boq/geometry.py`). The sidecar is an
engine file, not part of the TypeScript contract.

| Part | Holds |
|---|---|
| `header` | file name, size, SHA-256, IFC schema, model view, authoring app, units and conversion, georeference, project, discipline guess, parse info |
| `spatial` | project, site, building, storeys (elevations), spaces, zones as a tree; spaces keep psets, quantities and volumes |
| `catalogues` | types, materials, layer sets, profiles, systems, classification references (elements point to these) |
| `elements` | raw names and properties, type properties separately, reported and geometric quantities side by side (never merged), references to storey, parent, children, host, openings, material, type |
| `openings` | host, filling, width, height, depth, area measured from geometry |
| `relationships` | contains, aggregates, nests, voids, fills, type assignment, space boundaries, connections, systems, groups |
| `verification` | checks with severity and elements involved (`CheckCode`: volume_mismatch, area_mismatch, inconsistent_winding, not_watertight, no_geometry, geometry_error, overlap, no_material, duplicate_material_name, flag_conflict, placeholder_value, no_quantities, unassigned_storey, proxy_element) and a summary count per code |
| `geometry` | pointer to the geometry store |
| `stats` | element, opening, space counts, count per class |

Deliberately raw: names, materials and property values exactly as in the file (tool-specific
sets like `PSet_Revit_Dimensions` stay in `psets`; only IFC quantity sets go in
`quantities.reported`), instance and type properties separate.

### MeasuredElement (`measured.ts`)

The vocabulary rules can use. Groups of fields: identity (guid, ifc_class normalised, family,
type_name, family_name, material and element_type as **dictionary terms**, materials, profile,
nominal_size, strength_class, raw names kept), location and status (storey, elevation, spaces,
zone, status new/existing/demolish/temporary, design option), flags (is_external, load_bearing),
dimensions (length, width, height, thickness, depth, diameter, cross-section, slope, elevations,
profile girth), areas (gross, net, footprint, developed, faces), volumes and mass (gross/net
volume, perimeter, mass, nominal mass per length, density), reinforcement and MEP fields, parts
(openings, layers, host, parent, children), classification references already in the IFC, all
properties flattened as `"Pset.Prop"`, `provenance` per numeric field (reported, geometry,
derived, user) and warnings.

Absent means "not applicable or not known", and that is what drives a rule's `onMissing`.
`MeasuredField` is an explicit string union of the numeric fields (kept in sync with the
interface by a compile-time check) so it can appear in the JSON Schema.

### BoqResult (`engine.ts`)

| Field | Meaning |
|---|---|
| `status` | `complete`, or `needs_input` when at least one **blocking** question is open |
| `ruleSet` | the flattened rule set actually used (snapshot; `meta.chain` shows the extends chain) |
| `lines[]` | `BoqLine`: key, ruleId, ruleKind (item/derived/manual), description, unit, quantity (`null` = flagged), source (measured/derived/manual/flagged), family, keys (line-key values), trace (formula, params used, elements with their share and a note, source line for derived), codes per code list, location (storey or storeys), tags, notes |
| `questions[]` | id (deterministic), kind, blocking, message, answer type (drives the UI control), guids, field/raw/occurrences for names, suggestion |
| `warnings[]` | code, message, guids, ruleId (e.g. double claims, mixed fields under a map rule, integrity problems) |
| `checks[]` | verification checks from parsing |
| `log[]` | ordered `LogEntry`: seq, stage, level (info/detail/warning), message, ruleId, lineKey, guid, data |
| `building` | `BuildingMeasures`: whole-building values formulas read as `building.*`, with provenance (reported / derived) and notes |
| `models[]` | `ModelReport` per model combined (one for a single model): file name, discipline, elements, taken, left to others, excluded by scope, duplicate GlobalIds, taken without owner |
| `stats` | elements, measured, excluded, unmatched, lines, flagged lines, decisions applied, duration |

Trace elements carry `model` (the model id) so a line can be followed back to its file.

`FederationSettings` (`engine.ts`, schema `federation-settings`, preset `presets/settings/federation.json`):
`disciplines` (each with `owns` selectors or `rest: true`), `storeyTolerance` (m), `duplicateOverlap`
(0-1). `ModelScope` = `{ include?, exclude? }` selectors per model (D44), stored per model version and BoQ by the backend.

`Decision` = `{ questionId, scope: "project" | "company", answer, note?, decidedBy?, decidedAt? }`.
`answer: null` means "leave it" (dismiss without answering).

## HTTP contract files

The product's HTTP API is specified in OpenAPI, not in `packages/types`:

| File | What | Client |
|---|---|---|
| `packages/api/openapi.yaml` | The core HTTP contract (every `/api/v1` operation the app and the Java backend share) | `@ifc-boq/api` (generated `packages/api/src/schema.d.ts`, openapi-fetch) |
| `packages/pricing-api/openapi-pricing.yaml` | The optional pricing module's contract (P36; not implemented, P48) | `@ifc-boq/pricing-api` |
| `packages/api/redocly.yaml` | Lint rules for both | |

`npm run api:lint` lints both, `npm run api:gen` regenerates the clients after an edit (`api:check`
fails CI when they are out of date). The Java build generates its interfaces and DTOs from
`openapi.yaml`. Conventions (auth, errors, pagination, idempotency, SSE):
[api-conventions.md](api-conventions.md); how to change the contract:
[docs/development/contract-changes.md](../development/contract-changes.md).

The proof of concept's own HTTP API (`/api/presets`, `/api/models`, `/api/runs`, served by
`engine/ifc_boq/api.py`) was removed in FE-046; it is in the git tag `poc-final`. Its quick
operations live on as engine quick calls behind the Java API (`names`, `codelist-read`,
`codelist-build`, `check`: [engine-worker.md](engine-worker.md)).
