# F05 Questions and decisions

> **Status (2026-11-28):** Built. Questions, answers, bulk answer, dismiss, the decisions page with CSV and promotion to the org dictionary are built. A run lists the questions it asked plus those its decisions answered (TF-137); a click on the preselected suggested answer accepts it (P54 Q60, TF-173); viewers see questions and decisions read-only (Q44). A `contradiction` above the resolution settings' block threshold (default 50 %) blocks; unit errors and implausible stated values recommend the geometry (review WP-A1, D71–D73). Copies of one object in two models that disagree raise a `duplicate_conflict` question per GlobalId, answered by naming the model whose copy is measured (review A-18, D86). Each question lists the lines its elements feed (review C-15, D121); contradictions read as "the file says …; the geometry measures … (−10 %)"; questions that change nothing (a name no rule reads) are under "For information", collapsed. Name questions can always be answered: "Not relevant" (the term `unspecified`), up to 3 fitting terms as one-click answers, a term search over translations and aliases; placeholders ("Default", "<By Category>") are asked without blocking (review C-16, D122). Replacing a colleague's answer is asked first, names the BoQs it applies to and notifies them; the "not applied yet" banner names who answered (review C-17, D123). The decisions page writes each question as the Questions tab does; its CSV has the answer in words beside the stored value (review C-18). In a federated BoQ the questions filter and group by model (review C-19).

## Purpose

The engine asks when it cannot decide: an unknown material name, a missing value, an element
no rule measures, a contradiction in the file, two models claiming the same element. Answers
are stored once per project and applied to every run, every BoQ and every new model version. That scope is
shown where it matters (review C-17, DEC-43): before an answer replaces a colleague's, the app names them
("Erin answered “Aluminium” on 23 Nov.") and the BoQs it applies to ("This answer applies to 3 BoQs in this
project: …"), and the colleague is told (`decision.replaced`).

## Question kinds (engine `QuestionKind`) and their answer controls

| Kind | Example message | Answer control (`AnswerType`) | Blocking |
|---|---|---|---|
| `unknown_name` | Material "BETON C25" (14 elements) is not in any dictionary | term picker (search the term hierarchy, with category) + "add to project dictionary" | if a rule needs the field |
| `missing_data` | Door D-12 has no width; rule "doors by area" needs it | number (with unit) or choice "flag the line" | rule's `onMissing: ask` |
| `unmatched` | 23 IfcFurniture "Chair-Desk" are not measured by any rule | rule picker or "exclude" | no (informative) |
| `double_claim` | Two rules measure the same slab for "area" | choice of rule | yes |
| `unclassified` | Line "Skirting, timber" has no code in "ACME cost codes" | code picker from that code list | if the map says `ask` |
| `classification_conflict` | Two map rules give different codes | code picker | no |
| `contradiction` | Wall W-3 reports 12.1 m³; geometry gives 9.8 m³; a slab states 1000× its volume (a unit error: the geometry is used) | choice (reported / geometry), recommended marked (the geometry when the stated value is a unit error or implausible) | when the difference is above the block threshold (resolution settings, default 50%), unless a unit error |
| `overlap` | Wall W-3 (Architecture) and W-77 (Structure) overlap 96% | choice (keep A / keep B / keep both) | yes |
| `orphan_override` (new, EN-003) | Your override on line "…" no longer matches a line | choice (remove override / keep for later) | no |

## Stories

- As an estimator, I see questions grouped by kind, blocking first, with element counts.
- I answer one question, or many at once (select ten unknown names → same term).
- I click a question to see its elements in the viewer and their properties.
- I dismiss an informative question ("leave it"), and it stops showing.
- As a library editor, I promote a name answer to the company dictionary so all future
  projects resolve it.
- As an estimator, I review all project decisions in one table, change or clear any of them,
  and see who decided what and when.

## Behaviour

1. **Questions tab** (BoQ workspace) lists `GET /runs/{runId}/questions` joined with project
   decisions: unanswered first, blocking first, then by kind, then by occurrences. Filter by
   kind, model, answered/unanswered. Answered rows show the answer and "changed in this run's
   inputs" if they were answered after the run.
2. **Answering** writes a project decision: `POST /projects/{projectId}/decisions`
   `{decisions: [{questionId, kind, answer, note?}]}` (one or many). With `?dryRun=true` the
   response lists revisions that would go back to draft (BR-23). The UI shows that warning
   only when the list is non-empty.
3. **Not auto-regenerated.** After answering, the header's pending banner counts the answers
   with any edits not applied yet ("1 edit and 2 answers not applied yet." · Apply now; review
   C-08, F06 §6). Applying is one click and fast. (Auto-regenerate after a pause of inactivity
   can be added later behind a user setting.)
4. **Suggestion:** if the question carries `suggestion`, it is preselected and marked
   "suggested"; a click on the preselected answer accepts it (writes the decision; Q60, P54).
5. **Name answers** (`unknown_name`): the picked term becomes a decision. "Also add to the
   project dictionary" (default on) writes an entry to the project dictionary preset (new
   draft auto-published, project layer). The decision stays as the record.
6. **Promote** (library editor): `POST /decisions/{decisionId}/promote {dictionaryPresetId}`
   publishes a new version of the chosen org dictionary with the entry added. It is audited.
   Projects pick it up when they use the latest version.
7. **Decisions page** (`/{org}/projects/{p}/decisions`): table of every decision: kind,
   question summary (raw text / element / line), answer, decided by/at, note, used in latest
   runs (yes/no). Edit and clear. Export CSV.
8. **Carry-over:** because question ids are deterministic (`name:{field}:{raw}`,
   `missing:{rule}:{guid}`, `unmatched:{class}:{type}`, `unclassified:{system}:{lineKey}`,
   `overlap:…`), answers apply automatically to new model versions and other BoQs (BR-04,
   BR-05). A decision whose question no longer appears is kept and marked "not used by
   current runs".
9. **Viewer link:** each question with `guids` has "Show in 3D", which opens the viewer with
   those elements isolated and their properties in the side panel.

## Edge cases

- One raw name appears in two models: one question, one decision (ids contain no model).
- A decision answered with a term that is later removed from the dictionary: the engine
  raises the name question again, and the decisions page marks the old decision "term no
  longer exists".
- Bulk answer across mixed kinds is not allowed: the selection is limited to one kind and one
  answer type.

## API

`GET /runs/{runId}/questions`, `GET /projects/{projectId}/decisions`,
`POST /projects/{projectId}/decisions` (`?dryRun=true`), `DELETE /decisions/{decisionId}`,
`POST /decisions/{decisionId}/promote`, `GET /orgs/{orgId}/terms`,
`GET /runs/{runId}/elements/{guid}`.

## Acceptance criteria

- [ ] Answering all blocking questions of a `needs_input` run and regenerating gives a `complete` run.
- [ ] Uploading a new model version with the same names asks nothing again (automated with the Duplex and a renamed copy).
- [ ] Bulk-answering 10 unknown names is one request and one regenerate.
- [ ] Changing a decision that an `approved` revision's run used warns first and, if confirmed, moves the revision to `draft`.
- [ ] A promoted answer appears in a new org dictionary version, and a new project using that version doesn't get the question.
