# Contract changes

How to change the HTTP contracts (`packages/api/openapi.yaml`,
`packages/pricing-api/openapi-pricing.yaml`), and the log of every change made after phase 1.
The contracts were written in the plan and proven against a mock API in phase 1 (removed by
P53). In phase 2 the backend owner changed them where the backend needed it (P47, D18 in
`docs/decisions.md`), and phase 3 (FE-041) adapted the app to every row. The same procedure
applies to any change from now on.

## How a change is made

1. **Decide.** A change the backend needs is the backend owner's; a change to what users can do
   or see is product behaviour and needs the product owner too. Record the reason here.
2. **Make it in one commit, contract first:**
   - edit the contract;
   - `npm run api:lint` and `npm run api:gen`;
   - update the shared suites (`tests/contract`, `tests/scenarios`) so they describe the new
     behaviour. They stay the spec that Java must pass;
   - update the Java backend for the changed operations (the Maven build regenerates its
     interfaces from `openapi.yaml`);
   - adapt `apps/app`. During the phased build this was the smallest change that kept it
     compiling, marked `// contract-change: <row id>` for phase 3; now that one session owns
     both sides, adapt the UI properly in the same commit (or mark the spot and list it below).
3. **List it below.** Additive changes are listed too (a new optional field the UI could show).
4. CI stays green: `api:lint`, `api:check`, typecheck, the app's tests, and the suites and
   browser smoke against Java (CI's `api` job).

## How phase 3 used this list (history)

FE-041 went through every row: it adapted the UI where the change affected it, removed the
`contract-change` markers, and set "Adapted" with its commit. The M8a exit criteria required
every row to be adapted, or marked "nothing to adapt". All of C01–C06 are adapted.

## Changes

| Id | Date | Operation(s) | Change | Why | Breaking for the app? | Product owner needed? | Adapted (phase 3) |
|---|---|---|---|---|---|---|---|
| C01 | 2026-11-16 | `listQuestions`, `listWarnings`, run log and line detail | Optional engine message codes and params. Existing warning codes and fallback messages keep their values. | EN-004, structured localization | No | No | Adapted in FE-041 (`a48496c`): questions, warnings, the run log and line detail render `engine.{code}` with the params, else the English `message` (`apps/app/src/i18n/engine-message.ts`, F15 §4). Every question and warning code has a catalogue entry except `rule_set` and `federation_hole`, whose params don't carry the whole message; log entries keep the fallback for now (`docs/product/known-limitations.md`) |
| C02 | 2026-11-16 | `listQuestions` | `orphan_override` is a non-blocking question when an edited line disappears. | EN-003, line edit auditability | No | No | Nothing more to adapt: the question-kind label was added in phase 2, and FE-041 (`a48496c`) renders the question from `engine.question.orphan_override` and removes a duplicate label key |
| C03 | 2026-11-16 | Run lines and manual items | An item-supplied classification code has source `item`. Engine ManualItem documents accept a code per system. | EN-007 | No | No | Adapted in FE-041 (`a48496c`): line detail names the code source `item` ("set on the item"); public line keys are unchanged |
| C04 | 2026-11-16 | `listWarnings` | Adds the `item_text_blank` warning code for a known field that is missing on a line. | EN-010 | No | No | Adapted in FE-041 (`a48496c`): the warning renders from `engine.item_text_blank` |
| C05 | 2026-11-18 | New `POST /auth/sign-in`, `POST /auth/set-password` (Java, when `BOQLET_NATIVE_AUTH=true`) | Native email and password sign-in (P50). Sign-in returns the session and sets the opaque HttpOnly cookie, or answers `409 session_active` with the active session for takeover; set-password consumes a one-hour setup or reset link. Added to Java in `06ffd99` without a contract change; FE-041 added them to `openapi.yaml`. | Deployment session replaced Keycloak (P50) | No (new operations; the app's native adapter calls them) | Recorded as P50 | Adapted in FE-041: both operations in `openapi.yaml` (tag `auth`, `security: []`), `404 native_auth_disabled` from the mock and from Java without native sign-in, contract tests; the app's native adapter (`06ffd99`) already calls them |
| C06 | 2026-11-20 | `createCheckout` | Without self-service billing, checkout answers `409 checkout_unavailable`: the platform admin sets the plan (`adminSetSubscription`). Java has done this since BE-021 without a contract change; recorded in FE-041. | D7: manual billing for pilots, Paddle deferred | Yes: the app expected a redirect URL | No (backend owner, D7) | Adapted in FE-041: the billing page shows the reason (`errors.codes.checkout_unavailable`); the shared scenarios set plans through `tests/support/plans.ts` |
| C07 | 2026-11-21 | Global `security` of `openapi.yaml` and `openapi-pricing.yaml` | Declares the real authentication: security scheme `session` (apiKey in cookie `boqlet_session`, P50) on every secured operation, with `bearer` (OIDC) only as the alternative that goes with the cookie in OIDC mode. Replaces the lone `bearer` scheme described as "provider to be decided, P10". Text only: no operation, schema or status changes | The contract described an undecided provider (docs reorganisation, 2026-11-21) | No: the generated TS types are unchanged and Java generates no security code (`annotationLibrary=none`) | No | Nothing to adapt |
| C08 | 2026-11-22 | Every operation with a JSON request body | `maxLength` on every free-text request field and `maxItems` on every request array (families in `info.description`: person names 120, names and labels 200, notes and descriptions 4,000, line descriptions and code-list cells 10,000, keys 4,000); over a limit → `400 invalid_body`. A JSON body over 1 MiB (32 MiB for `saveDraft`, `checkPreset`, `buildCodeList`, `namesInModel`, `upsertDecisions`, `applyLineEdits`) → `413 too_large`. The generated TS types are unchanged (openapi-typescript emits no lengths) | TF-174: an unbounded name was copied into every response that embeds the user and ran the API out of memory | Yes, for input over a limit: the app should cap its inputs and translate `invalid_body` and `too_large` | No (backend owner, security) | Not yet: inputs and messages are the app's |
