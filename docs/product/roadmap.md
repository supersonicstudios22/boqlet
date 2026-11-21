# Roadmap

Where the product goes next. **Nothing is scheduled**: the owner picks what comes next, and a
session works only on what the owner asked for ([../development/workflow.md](../development/workflow.md)).
This page lists the candidates with their reasons, so the owner can choose and an agent can see how
a task fits. Each candidate should move an outcome in [overview.md](overview.md) (O1–O10) or close
a gap in [known-limitations.md](known-limitations.md).

## Now: finish and harden v1 (owner's or operator's items)

| Item | Why | Who |
|---|---|---|
| Person checks of v1 criteria 4 (traceability), 7 (Library) and 12 (first setup in < 15 min) | The only v1 criteria not checked at all | Owner |
| Open exported workbooks in Excel and LibreOffice by hand | F12-AC1 is checked with openpyxl only | Owner or agent with LibreOffice |
| A live acceptance run on booqlet.com with synthetic accounts (`ops/pilot/verify-live.sh`) | v1 acceptance ran on CI's local native stack, not on the pilot | Operator with host access |
| On the host: apply `ops/pilot/compose.yaml` (JSON logs, metrics); install `ops/pilot/backup.sh` with an off-host copy; an alert destination; error tracking | Pilot operations are not qualified ([../operations/pilot.md](../operations/pilot.md)) | Operator |
| Remove or repoint the old Vercel demo project | `main` no longer has the PoC (tag `poc-final`) | Owner |

## Next: engineering candidates, roughly in order of value

1. **Restore test coverage lost with the mock (P53)**: let the shared suites run against the local
   stack (a test image of the API with `SuiteSupport`, or a suite profile), port the browser flows
   that matter to `apps/app/e2e-java` (sheet edits, questions, Library editors, versions, exports,
   admin, setup wizard), and bring back the axe and pseudo-locale checks. Protects O2–O7 on every push.
2. **Large uploads**: multipart upload with progress and resume in the app (Java already signs the
   parts). Without it, real projects over 100 MB can't be uploaded (O1).
3. **Collect a minimum real-world corpus**: modern Revit IFC4, Archicad, Tekla with rebar, Bonsai,
   a federated office set, and **2–3 reference projects with a professional BoQ** as the answer key.
   Run each with `npm run corpus`, fix quirks, add tests. Nothing else de-risks accuracy as much (O1, O3).
4. **Names at scale** (Q8): per-language seed dictionaries, a public term source (bSDD), or AI
   suggestions with confirmation. Unknown local names are the main source of questions on real files (O4).
5. **Medium-model parse time** (9 min vs 5): another geometry kernel or settings, a faster schema
   check of the parsed model, spatial index for the overlap check, meshes loaded per need (O1).
6. **Editing scope rules and default presets in the UI** (F02, F03): the engine and API already
   support them (O1, O2).
7. **Setup wizard as specified** (F16): "Suggest codes", names filtered to those worth asking, the
   sample Duplex as the wizard's model; the person check of criterion 12 (O2).
8. **Coordinate alignment between federated models** (Q11) (O1).
9. **Self-service accounts for public launch** (P08, P17): public sign-up with bot protection
   (BE-D12), self-service password reset, a payment provider behind the billing adapter (BE-D7), trial
   and downgrade rules; then Q18 and Q26 (tiers and prices) and Q19 and Q20 (legal) must be answered (O8).
10. **A staging environment** (BE-032, P51) before real users depend on the pilot.
11. **Translations**: give engine log entries and answer options codes and structured params, then
    add a second UI language (P07, F15).
12. **Client template import** (spreadsheet, then GAEB) and more export formats (GAEB, ÖNORM A 2063,
    CSV, IfcCostSchedule), per market (Q12).
13. **IDS input checks** per preset.
14. **The pricing module** (P32–P36, P48): its Java module (BE-P1…), engine sheets (EN-P1) and
    frontend (FE-P1…), on the extension points that already exist (O10). The task lists are in
    [../archive/plan/](../archive/plan/) (`tasks-*.md`, "MP1", "MP2").

## Product and business (non-engineering)

- Interview and pilot with design and engineering firms (Q1–Q3): do they produce tender BoQs
  themselves, will they pay per seat, are their models good enough?
- Find a **QS partner** to review the rules and the flow and to encode the first real rulebook preset.
- Legal review of the licensing position for the first target markets ([../domain/sourcing-and-licensing.md](../domain/sourcing-and-licensing.md)).

## Later (out of v1 by decision)

Kept from the v1 scope ([scope-and-acceptance.md](scope-and-acceptance.md#out-of-v1-later-in-rough-order)):
support inbox and announcements in the admin console; vendor company accounts; "start from your
last BoQ" in the setup wizard (Q23); automatic matching of pricebook items; teams; custom roles,
SSO / SCIM; pulling models from CDEs; design options; mobile layouts beyond read-only; on-premise
packaging. **Dropped**: formal tendering (P34), construction-phase features (P32), BCF (P06).
