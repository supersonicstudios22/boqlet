# Contract changes after phase 1

The contracts (`packages/api/openapi.yaml`, `packages/pricing-api/openapi-pricing.yaml`) were
written in the plan and proven against the mock in phase 1. In phase 2 the backend owner may
change them when the backend needs it (P47, `07-backend/decisions-to-make.md` D18). The owner
runs the final frontend phase and adapts the app (FE-041). This file is how such a change is
made, and the list of every change, so that phase 3 knows what to adapt.

## How a change is made (phase 2)

1. **Decide.** The backend owner decides, and records the reason here. A change to what users
   can do or see is product behaviour: it needs the product owner too.
2. **Make it in one commit, contract first:**
   - edit the contract;
   - `npm run api:lint` and `npm run api:gen`;
   - update the shared suites (`tests/contract`, `tests/scenarios`) so they describe the new
     behaviour. They stay the spec that Java must pass;
   - update the Java backend for the changed operations (since P53 there is no mock to update);
   - make the **smallest change in `apps/app`** that keeps it compiling and its tests green.
     That means renamed fields and adjusted calls, never a redesign. Mark each spot with
     `// contract-change: <row id>`.
3. **List it below.** Additive changes are listed too (a new optional field the UI could show).
4. CI stays green: lint, typecheck, the app's tests, the suites and browser tests against Java.

## How phase 3 uses this list

FE-041 goes through every row: it adapts the UI properly where the change affects it, removes
the `contract-change` markers, and sets "Adapted" with its commit. The M8a exit criteria
require every row to be adapted, or marked "nothing to adapt".

## Changes

| Id | Date | Operation(s) | Change | Why | Breaking for the app? | Product owner needed? | Adapted (phase 3) |
|---|---|---|---|---|---|---|---|
| C01 | 2026-11-16 | `listQuestions`, `listWarnings`, run log and line detail | Optional engine message codes and params. Existing warning codes and fallback messages keep their values. | EN-004, structured localization | No | No | Adapted in FE-041 (`a48496c`): questions, warnings, the run log and line detail render `engine.{code}` with the params, else the English `message` (`apps/app/src/i18n/engine-message.ts`, F15 §4). Every question and warning code has a catalogue entry except `rule_set` and `federation_hole`, whose params don't carry the whole message; log entries keep the fallback for now (`docs/11`) |
| C02 | 2026-11-16 | `listQuestions` | `orphan_override` is a non-blocking question when an edited line disappears. | EN-003, line edit auditability | No | No | Nothing more to adapt: the question-kind label was added in phase 2, and FE-041 (`a48496c`) renders the question from `engine.question.orphan_override` and removes a duplicate label key |
| C03 | 2026-11-16 | Run lines and manual items | An item-supplied classification code has source `item`. Engine ManualItem documents accept a code per system. | EN-007 | No | No | Adapted in FE-041 (`a48496c`): line detail names the code source `item` ("set on the item"); public line keys are unchanged |
| C04 | 2026-11-16 | `listWarnings` | Adds the `item_text_blank` warning code for a known field that is missing on a line. | EN-010 | No | No | Adapted in FE-041 (`a48496c`): the warning renders from `engine.item_text_blank` |
| C05 | 2026-11-18 | New `POST /auth/sign-in`, `POST /auth/set-password` (Java, when `BOQLET_NATIVE_AUTH=true`) | Native email and password sign-in (P50). Sign-in returns the session and sets the opaque HttpOnly cookie, or answers `409 session_active` with the active session for takeover; set-password consumes a one-hour setup or reset link. Added to Java in `06ffd99` without a contract change; FE-041 added them to `openapi.yaml`. | Deployment session replaced Keycloak (P50) | No (new operations; the app's native adapter calls them) | Recorded as P50 | Adapted in FE-041: both operations in `openapi.yaml` (tag `auth`, `security: []`), `404 native_auth_disabled` from the mock and from Java without native sign-in, contract tests; the app's native adapter (`06ffd99`) already calls them |
| C06 | 2026-11-20 | `createCheckout` | Without self-service billing, checkout answers `409 checkout_unavailable`: the platform admin sets the plan (`adminSetSubscription`). Java has done this since BE-021 without a contract change; recorded in FE-041. | D7: manual billing for pilots, Paddle deferred | Yes: the app expected a redirect URL | No (backend owner, D7) | Adapted in FE-041: the billing page shows the reason (`errors.codes.checkout_unavailable`); the shared scenarios set plans through `tests/support/plans.ts` |
