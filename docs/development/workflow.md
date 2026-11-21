# How to work on boqlet

How an agent session (or a developer) works on the product since the v1 release. The phased build
(P38, P45) is over; its session protocol, milestones and task lists are history in
[../archive/plan/](../archive/plan/README.md). What is still valid of it is here.

## Before any task

1. Read [CLAUDE.md](../../CLAUDE.md), then [the product overview](../product/overview.md). Check
   that the task serves an outcome there (O1–O10) and keeps the product principles. If it would
   break a principle or a settled decision ([../decisions.md](../decisions.md)), stop and ask.
2. `git switch main && git pull`, then `git status`. If the tree isn't clean and you don't know why,
   ask before touching those changes (don't stage files you didn't change).
3. Read the docs for the area you touch (the map in [../README.md](../README.md)): the feature spec
   and its status block, the architecture page, the known limitations.
4. Set up what's missing ([local-setup.md](local-setup.md)) and run the baseline for the area
   (`npm run test` at least). If something is red before you change anything, say so.

## Working

- **Work on `main`**, no feature branches (P40, since the release). **Every green push to `main`
  deploys to booqlet.com** (P51), so never push red: typecheck, lint and the affected tests pass
  before each commit. CI must be green after the push ([../testing/README.md](../testing/README.md#ci)).
- **Small commits**, each message starting with the task or finding id when there is one
  (`TF-012: …`, `P53: …`), ending with the attribution lines the session asks for.
- **Rules of the road** (CLAUDE.md) always apply: types first, contract first, no measuring logic in
  rules, formulas only in `expr.py`, nothing silently dropped, classification never changes a
  number, Duplex test green, no licensed standard content, deterministic question ids,
  international defaults.
- **Contract changes** follow [contract-changes.md](contract-changes.md): change
  `packages/api/openapi.yaml` first, `npm run api:lint`, `npm run api:gen`, then Java and the app in
  the same commit, and record the change id.
- **UI** follows [design-guidelines.md](design-guidelines.md) (P43): no literal UI strings (ESLint
  rule; every string through `apps/app/messages`), shadcn components through `npm run ui:add`.
- **Every fix comes with a test** at the lowest layer that can show it.

## Yours to decide, or the owner's

| Decide yourself (and note it in the commit, or in the doc it changes) | Ask the owner first |
|---|---|
| Libraries and versions inside the existing stack (pin them) | Product behaviour a spec doesn't define, or where two specs contradict each other |
| File layout and internal interfaces inside a package | Anything that changes a P-decision or a BR rule |
| Test structure, fixtures, helpers | A contract change that changes behaviour (fixing a contract that contradicts its spec is yours) |
| Small UI details the guidelines and screens already imply | A visual decision the design guidelines don't cover |
| Fixing a bug found in earlier work (with a test) | Anything needing an account, a secret or money (hosting, email, billing, auth providers) |
| | Deleting or rewriting something outside the task's scope; anything destructive or irreversible (force-push, history rewrites, deleting data or accounts, publishing) |

When a question blocks you: add it to [../product/open-questions.md](../product/open-questions.md)
(next Q-number, "Blocks: …"), ask, and go on with what doesn't depend on it. Never guess product behaviour.

## After every task: write it down

| What | Where |
|---|---|
| The work done (date, commit, one line) | [../changelog.md](../changelog.md) |
| A limitation the task leaves, removes or reveals | [../product/known-limitations.md](../product/known-limitations.md) |
| A gap closed or opened against a feature spec | the spec's status block in [../product/features/](../product/features/README.md) |
| A new decision (product: the owner's) | [../decisions.md](../decisions.md), next id of its series |
| An open question | [../product/open-questions.md](../product/open-questions.md) |
| A change to how things work (architecture, commands, env vars, tests) | the one doc that owns the topic ([../README.md](../README.md)); never a second copy |
| A test campaign's findings | [../testing/test-findings.md](../testing/test-findings.md) |

Keep docs true: if you notice a doc that disagrees with the code, fix the doc (the code wins for how
things work), or note it as a limitation if the code is what's wrong.

## Tooling

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS (20 works) | npm workspaces (`apps/*`, `packages/*`, `tests`); no pnpm or yarn |
| Python | 3.10–3.13 | The engine's venv in `engine/.venv`, created by `npm install` |
| Docker | with Compose v2 | The local backend (`ops/local`) and Java's integration tests (Testcontainers) |
| Java, Maven | 21, 3.9 | Only to build and test `services/api` outside Docker (no `mvnw` in the repo) |
| Playwright | pinned in `apps/app` | `npx playwright install chromium` for `e2e-java` |
| Operating systems | Windows 11 (the owner's machine, PowerShell) and Linux in CI | Scripts in Node or Python, never bash-only; build paths with `path.join` |
| CI | GitHub Actions | `.github/workflows/ci.yml`, on pushes and PRs to `main` (and the frozen `v_1`) |
