# Archive

History, kept so nothing is lost and nobody re-proposes what was already tried. **Nothing here is
current**: each file opens with a banner that says what superseded it. Paths, test names and
commands inside these files are as they were when written (for example `plan/`, `apps/mock-api`,
`apps/app/e2e`, branch `v_1`). Use them to understand why the code is as it is; never as
instructions.

| Path | What it is |
|---|---|
| [build-log.md](build-log.md) | The build log of phases 1–3: milestone and phase summaries, the agents' implementation decisions and deviations, the P53 entry |
| [limitations-history.md](limitations-history.md) | Known limitations of the proof of concept's dev build and of phase 1 on the mock |
| [overview-2026-10.md](overview-2026-10.md) | The engine overview of October 2026 (old `docs/00`) |
| [architecture-2026-10.md](architecture-2026-10.md) | The architecture of the proof of concept and the then-planned platform (old `docs/03`) |
| [platform-design-2026-10.md](platform-design-2026-10.md) | The pre-build platform design (old `docs/10`) |
| [plan/](plan/README.md) | The build plan's process documents: README, milestones, sessions, task lists (still the detailed spec of the unbuilt pricing tasks), the mock API, reuse from the proof of concept, the BE-000 questions, answers and review, the old system and API-folder pages |
| [reference/knowledge-base-2026-10-03.md](reference/knowledge-base-2026-10-03.md) | The consolidated 16-section knowledge base of 3 Oct 2026, written before the rule type and the engine were built: the fullest single account of the domain, gaps, sourcing and platform thinking |
| [reference/conversation/](reference/conversation/) | The original conversation, turn by turn (parts 1–4): every question and every answer's prose, verbatim (tool calls and code omitted) |
| `reference/files/*.docx, *.xlsx` | Documents produced during that conversation: the six knowledge gaps, the remaining gaps, sourcing of rulebooks and classifications, the rulebook / classification and dictionary / item-library spreadsheets, the test corpus plan |
| `reference/prototype-2026-10/*.py` | The first prototype pipeline that produced the hand-made Duplex BoQ (extract, overlap check, classify, build Excel); its output is `fixtures/reference/duplex-hand-boq.xlsx` |

The proof of concept itself (the React dev UI `apps/web`, the engine's dev API `engine/ifc_boq/api.py`
and `store.py`, the Vercel demo) is the git tag `poc-final`; the mock API is in the history before
commit `cf58e32`.
