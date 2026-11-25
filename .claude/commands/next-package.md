---
description: Do the next work package from the review blueprint (docs/review/BLUEPRINT.md)
---

Continue the review blueprint: do the next work package.

1. Read CLAUDE.md, then docs/review/PROGRESS.md ("How to use this file"), then the parts
   of docs/review/BLUEPRINT.md the package needs: its section-5 entry, its items in
   section 4, the decisions it cites in section 3, and section 6.2 (practical notes).
2. Pick the package yourself: the first package in BLUEPRINT.md section 5's order whose
   status in PROGRESS.md is todo (or in progress from an unfinished session) and whose
   prerequisites are all done. Skip packages that are blocked, or whose open items all
   wait on an owner decision or input (say which). Mark it in progress with today's date.
   Do only that one package. If it is too large, finish a coherent subset and split the
   rest as PROGRESS.md describes.
3. Setup: run `npm run local:up` (Docker Desktop must be running; if it isn't, stop and
   tell me) and `bash docs/review/tools/fetch-samples.sh`.
4. Run the entry check. If it fails because of an earlier package, record that in
   PROGRESS.md and stop. Otherwise do the items one at a time: tests first where
   practical, one commit per item on main, with the CLAUDE.md after-task duties
   (changelog, known-limitations, feature status, decisions; HAND_BOQ with a reason if
   Duplex numbers move).
5. Run the exit check exactly as the package states, including
   `docs/review/tools/compare-baseline` (`--parse-cache` while iterating, the full run at
   the end; `npm run local:up` again before the stack layer if engine or API code changed)
   and `docs/review/tools/verify-quantities`. Record every baseline difference in
   PROGRESS.md as intended (with item id) or fix it as a regression. Recapture the
   baseline in the same commit when output changes on purpose. Run
   `docs/review/tools/check-blueprint.py` if you edited BLUEPRINT.md.
6. Update PROGRESS.md: status, date, commits, baseline changes, notes, new items found.
   New problems become new items for a later package, never silent scope changes.
7. Do not push. I review and push myself.

Don't ask me questions mid-package. For items marked "owner to confirm", use the
documented fallback or mark them blocked, and record judgement calls in PROGRESS.md and
the blueprint's decision log. End with a short summary: the package done, commits,
baseline changes, anything blocked, and which package is next.

$ARGUMENTS
