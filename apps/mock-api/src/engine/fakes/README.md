# Engine fakes (phase 1, P39)

Empty since FE-042: every engine fake of phase 1 was replaced by the engine worker and deleted.
This folder holds only this README (FE-042 checks it).

The fakes were behind the `Engine` interface in `../engine.ts`, each listed in
`plan/06-frontend/mock-api.md` "Engine fakes" with the engine task that replaced it:

- line edits applied and manual items with codes: EN-003, EN-007 (the mock still orders the
  lines, `../../line-order.ts`);
- trace steps: EN-013 (the mock still adds an edit's author, `../../trace-authors.ts`);
- the BoQ export, the edits import and the change report's Excel: EN-006 (`../exports.ts`);
- the change report: EN-002 (`../../handlers/diffs.ts` sends the worker what differs).

A new fake, if one is ever needed, goes here as `<name>.ts` and gets a row in that table. Fakes
never measure (BR-01): they only rearrange, relabel or apply values a person entered.
