# Frontend architecture

The product frontend lives in `apps/app`. It is a **UI only**: no business logic, no quantity
computation (BR-01), no direct engine access. It talks to the Java backend through the client
generated from `packages/api/openapi.yaml` (`@ifc-boq/api`).

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router)**, React 19, TypeScript strict | Next.js **16.4.6**, React **19.3.1** (pinned in FE-001). `output: "standalone"` for containers |
| Data fetching | **TanStack Query v5** + `openapi-fetch` client generated with `openapi-typescript` | Server state lives only in the query cache |
| Realtime | SSE via `@microsoft/fetch-event-source` (sends auth headers) | One connection per tab, in the app layout |
| Tables | **TanStack Table v8 + TanStack Virtual** | BoQ sheet, comparison, decisions, audit |
| Forms | plain React state and controlled inputs (no form library) | Server validation is the authority |
| URL state | Next's `useSearchParams` (no `nuqs`) | Tabs (`?tab=`), selected line (`?line=`) |
| Client state | React state and context (no Zustand) | |
| i18n | **next-intl** (ICU) | `messages/en/*.json`, pseudo-locale `en-XA` |
| Styling | **shadcn/ui** from preset `b38miVKzY` (Tailwind CSS 4 + Base UI primitives, components kept in the repo), tokens from `design-guidelines.md`; fonts JetBrains Mono (UI) and Inter Tight (display), self-hosted via `@fontsource-variable/*` | **Decided (P23, P43)** |
| 3D | three.js 0.169 over the engine's `geometry.glb` (`src/features/viewer`, ported from the PoC viewer) | Lazy-loaded chunk |
| Decimals | none yet (`big.js` was planned for pricing-module amounts, BR-47) | |
| Tests | Vitest + Testing Library (unit); Playwright browser tests against Java (`e2e-java`, `npm run e2e:java -w @ifc-boq/app`) | docs/testing/README.md |
| Lint | ESLint (next, typescript; a no-literal-strings rule for UI text, F15). No Prettier | No literal UI strings (F15) |
| Errors and monitoring | no error tracking (Sentry not set up, needs an account) | |

### Pinned versions

Set in FE-001; change them deliberately and update this table.

| Package | Version | Where |
|---|---|---|
| `next` | 16.4.6 | `apps/app` |
| `react`, `react-dom` | 19.3.1 | `apps/app` |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.5 | `apps/app` |
| `@base-ui/react` | 1.9.0 | `apps/app` (shadcn/ui style `base-mira`, preset `b38miVKzY`) |
| `shadcn` | 4.23.0 | `apps/app` (only for `shadcn/tailwind.css`; components are added with `npm run ui:add -w @ifc-boq/app -- <name>`, see below) |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `lucide-react` | 0.7.1, 2.1.1, 3.7.0, 1.4.0, 1.72.0 | `apps/app` |
| `openapi-typescript` | 7.13.0 | product root (`npm run api:gen`) |
| `openapi-fetch` | 0.17.0 | `packages/api`, `packages/pricing-api` |
| `@redocly/cli` | 2.77.0 | product root (`npm run api:lint`) |
| `next-intl` | 4.15.1 | `apps/app` (no locale in the URL; the cookie `boqlet-locale` carries the user's language) |
| `@tanstack/react-query` | 5.107.1 | `apps/app` |
| `@tanstack/react-table`, `@tanstack/react-virtual` | 8.21.3, 3.13.12 | `apps/app` (the BoQ sheet, FE-009: Table owns the columns and their visibility, Virtual the rows; both are skipped by the React Compiler, see the `incompatible-library` comments) |
| `three`, `@types/three` | 0.169.0 | `apps/app` (the 3D viewer, FE-016; the PoC's version, loaded on demand when a viewer opens) |
| `next-themes`, `sonner` | 0.4.6, 2.0.8 | `apps/app` (theme class on `<html>`, default "system"; toasts) |
| `@fontsource-variable/jetbrains-mono`, `@fontsource-variable/inter-tight` | 5.3.0 | `apps/app` (self-hosted, every subset incl. Latin Extended and Cyrillic) |
| `eslint`, `eslint-config-next` | 9.39.5, 16.4.6 | `apps/app` (ESLint 10 is not supported by `eslint-plugin-react` yet) |
| `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `jsdom` | 5.1.0, 6.3.0, 16.3.3, 31.0.0 | `apps/app` (`npm run test` goes through `scripts/vitest.mjs`, which upper-cases a Windows drive letter in the cwd; Git Bash otherwise makes Vitest load itself twice) |
| `@playwright/test` | 1.65.0 | `apps/app` (`npx playwright install chromium` once per machine) |
| `@axe-core/playwright` | 4.14.0 | `apps/app` dev dependency, currently unused: the accessibility suite `e2e/a11y.spec.ts` (TS-003) was deleted with the mock-only browser suite (P53); port it to `e2e-java` |
| `@microsoft/fetch-event-source` | 2.0.1 | `apps/app` (SSE) |
| `keycloak-js` | 26.2.5 | `apps/app` (the `keycloak` rollback adapter only) |
| TypeScript | 5.x (5.9 installed) | every workspace |

**shadcn components.** The registry's `base-mira` components import `cn` from an npm package
named `cn`; this repo doesn't take that dependency. `apps/app/scripts/ui-add.mjs` fetches a
component (and its registry dependencies) from `https://ui.shadcn.com/r/styles/base-mira/`,
points `cn` at `src/lib/utils.ts` (the classic clsx + tailwind-merge helper) and prints any npm
dependency still to add. Don't run `npx shadcn add` directly: it tries to install `cn`.
Local changes to added components (re-applied by hand after `ui:add --overwrite`): `dialog.tsx`
translates its "Close" text (`common.close`); `button.tsx` default and icon sizes are 32 px with
13 px text (the guidelines' control density); `button.tsx`, `badge.tsx`, `input.tsx` and `select.tsx`
use the full-strength `ring-ring` focus ring (not `ring-ring/30`), and the destructive variant of
`button.tsx` and `badge.tsx` is a red fill with `text-destructive-foreground` (WCAG contrast, TF-162).
`skeleton.tsx` is used through `LoadingLines` (`src/components/loading.tsx`); a failed query shows
`InlineError` (`src/components/errors/inline-error.tsx`, message and Try again).

## Rendering model

- The app is behind authentication and is data-heavy. Pages are **client components that fetch
  through TanStack Query**. Server Components are used for layouts, static chrome and the
  public pages (sign-in shell, invitation previews).
- **No Next.js route handlers with business logic.** Next serves the UI. The API is a separate
  service on the same domain: the client calls `NEXT_PUBLIC_API_BASE_URL` (default `/api/v1`);
  in development the route handler `app/api/v1/[...path]/route.ts` (`src/api/proxy.ts`) passes
  `/api/v1/*` to `API_PROXY_TARGET` (default the local Java API, `http://localhost:8080`) and answers
  `503 api_unavailable` when it can't be reached (TF-183); in production the edge routes `/api/v1`
  to the API (the handler answers only when `API_PROXY_TARGET` is set). That handler is the only
  route handler, and it only forwards.
- Next middleware is allowed only to redirect unauthenticated users to `/sign-in`, when the
  auth adapter exposes a cookie the middleware can check.

## Folder structure

```text
apps/app/
  app/
    (public)/sign-in/[[...rest]]/page.tsx
    (public)/sign-up/[[...rest]]/page.tsx
    (public)/reset-password/page.tsx
    (public)/invite/[token]/page.tsx
    (public)/s/[token]/page.tsx       # share link (F18)
    (public)/session-conflict/page.tsx
    (app)/layout.tsx                   # auth gate, SSE connection, QueryClientProvider, IntlProvider
    (app)/onboarding/page.tsx
    (app)/account/page.tsx
    (app)/notifications/page.tsx
    (app)/[org]/layout.tsx             # org chrome: top bar, left nav, org resolution by slug
    (app)/[org]/page.tsx               # dashboard
    (app)/[org]/projects/new/page.tsx
    (app)/[org]/projects/[projectId]/layout.tsx      # project sub-nav
    (app)/[org]/projects/[projectId]/page.tsx
    (app)/[org]/projects/[projectId]/models/…
    (app)/[org]/projects/[projectId]/boqs/[boqId]/page.tsx   # workspace with ?tab=
    (app)/[org]/projects/[projectId]/decisions/page.tsx
    (app)/[org]/projects/[projectId]/library/…
    (app)/[org]/projects/[projectId]/settings/page.tsx
    (app)/[org]/projects/[projectId]/activity/page.tsx
    (app)/[org]/library/…
    (app)/[org]/settings/{general,members,billing,usage,audit,shares}/page.tsx, [section]/page.tsx (module sections)
    (app)/[org]/setup/page.tsx         # setup wizard (F16)
    (app)/areas/[area]/[[...segments]]/page.tsx   # module areas (area.routes); none registered
    (admin)/admin/{,orgs,orgs/[orgId],users,plans,plans/new,plans/[planId],settings,funnel,health}/page.tsx   # platform admin console (F19)
  src/
    api/            client.ts, keys.ts (query keys), hooks/<resource>.ts, errors.ts, global-errors.ts, query-client.ts
                    (the generated types are in packages/api/src/schema.d.ts, imported from @ifc-boq/api)
    auth/           AuthAdapter.ts, adapters/native.tsx (P50, default), adapters/keycloak.tsx (rollback),
                    auth-gate.tsx, app-session.ts, session-conflict.tsx, leaving.ts
    realtime/       sse.ts (connect, reconnect, Last-Event-ID), invalidation.ts (event → query keys)
    features/       one folder per feature: admin, audit, boq-sheet, boqs, changes, decisions, exports,
                    library, models, notifications, orgs, projects, questions, settings, setup, shares,
                    versions, viewer (three.js)
    extensions/     the extension registries (nav, workspace tabs, selection actions, line badges,
                    settings sections, areas, notification kinds); empty by default
    components/     ui/ (shadcn), shell/, errors/ (incl. the limit dialog), shared components
    i18n/           config.ts, request.ts, engine-message.ts, units.ts, use-relative-time.ts
    lib/            permissions.ts, utils.ts
    modules.ts      the only place a module would be registered (MODULES = [])
  messages/en/*.json, messages/en-XA/ (generated pseudo-locale)
  e2e-java/         Playwright browser tests against Java (playwright.java.config.ts)
```

There is no `packages/pricing-ui` (the pricing module is deferred, P48). Its planned shape:
`src/register.ts` registering routes (`[org]/pricing/*`, `/vendor/*`, `/vendor-invite/[token]`),
tabs, actions, badges, nav items and the `pricing` i18n namespace with the core registries.

## Data layer rules

1. **Generated types only.** No hand-written API types. `npm run api:gen` regenerates
   `packages/api/src/schema.d.ts` from `packages/api/openapi.yaml` (`npm run api:check` fails CI
   when it is stale). Engine types (`BoqLine`,
   `Question`, `RuleSet`...) come from `@ifc-boq/types` when a component needs the engine
   shape directly (Library editors).
2. **Query keys** are centralised in `src/api/keys.ts`: `['project', id]`, `['run', id, 'lines', params]`...
3. **Immutable data is cached forever:** runs that finished, their lines/questions/log, model
   versions that are `ready`, preset versions that are published, scene/geometry
   (`staleTime: Infinity`). Mutable lists use `staleTime` 30 s plus SSE invalidation.
4. **SSE → invalidation map** (`realtime/invalidation.ts`):
   - `job.finished {type: "parse", subjectId}` → `['modelVersion', subjectId]`, `['models', projectId]`
   - `job.finished {type: "run"}` → `['revision', …]`, `['runs', revisionId]`, `['boq', …]`
   - `entity.changed {entityType, entityId}` → that entity and its parent lists
   - `notification.created` → `['notifications']` + toast when relevant
5. **Mutations** use optimistic updates for decisions, overrides, manual items and
   notification reads (offer draft rates once the pricing module exists). They roll back on error and show the translated error.
6. **Errors:** one `ApiError` class with `code`, `details`, `status`. Global handling: `401` →
   `auth.signIn({returnTo})`; `402` → `<LimitDialog>` (F14); `404` → route `notFound()`;
   `409 revision_locked` and other state conflicts → a toast and refetch. Everything else →
   inline error with retry.
7. **Permissions:** `can(resource.permissions, "approve")` for UI gating, from the API's
   `permissions` objects. Org-level from `GET /me`. Never infer permissions from roles in more
   than one place (`src/lib/permissions.ts`).

## Auth adapter

```ts
export interface AuthAdapter {
  /**
   * "loading" until the provider has restored a session; "unavailable" while the API can't be reached
   * to ask (a restart, a deploy): not signed out, and the provider asks again by itself.
   */
  useSession(): { status: "loading" | "authenticated" | "anonymous" | "unavailable"; email?: string; name?: string };
  /** Bearer token for API calls, or null when the provider uses cookies. */
  getAccessToken(): Promise<string | null>;
  signIn(opts?: { returnTo?: string; email?: string }): Promise<void>;
  signUp(opts?: { returnTo?: string; email?: string }): Promise<void>;
  signOut(): Promise<void>;
  /** Ask again for the session after "unavailable" (the person's Try again). */
  retrySession?(): void;
  /** Optional embedded UI for providers that render forms in-app. */
  SignInPage?: React.ComponentType;
  SignUpPage?: React.ComponentType;
}
```
- `native` adapter (P50, the default): email and password forms on the boqlet domain; the API
  sets an opaque HttpOnly session cookie. Restoring the session, a 4xx means signed out; no answer or
  a 5xx means "unavailable" (asked again every 5 s), so an API restart never signs anyone out. The
  auth gate shows "unavailable" as an error with Try again (`retrySession`). `keycloak` is kept for the rollback (docs/operations/auth-and-deploys.md). The
  `mock` adapter (seeded users, `mock:<userId>` tokens) was removed with the mock API (P53). No
  component imports a provider SDK directly.

## BoQ workspace (the heaviest screen)

- Route `/{org}/projects/{p}/boqs/{b}?rev=&tab=&line=&group=`. Default: the current
  revision, Sheet tab.
- Loads `boq` → `revision` → `currentRun` → `lines` (one request, `limit=20000`,
  `src/api/hooks/sheet.ts`), in parallel with `questions` count and `warnings`. **Gap:** the
  planned switch to server-side grouping above 20k lines is not built, although Java supports
  `groupBy`/`level` (`boq/RunReads.java`).
- Grouping by code path is done client-side with memoised selectors.
- Selection (line keys, element GlobalIds) is shared between sheet, detail panel and viewer
  through React state in the workspace; the selected line is mirrored to `?line=`.
- The viewer is a lazy chunk. It loads `geometry.glb` for each input model version and
  `scene.json`, `coverage` for the run.

## Library

`src/features/library` holds the Library editors (rule sets, classifications, dictionaries,
resolution settings), ported from the PoC Library (done in phase 1; the PoC is the tag
`poc-final`, `docs/archive/plan/reuse-from-poc.md`). It keeps the PoC's components and
plain-language "story" helpers (`lib/readable.ts`, `dictionary/dict-story.tsx`,
`classification/class-story.tsx`) and uses the API for drafts (autosaved, ETag), publish,
versions, where used and preview.

The editors keep no copy of engine text or expression logic (rule 4, review B-13): an item text's
"Reads as" and its samples come from `POST /presets/item-texts/sample` (rpc `item-text-sample`; the
engine splits the template and fills it with its own number format, without a preview run;
`api/hooks/item-texts.ts` debounces typing and sends a page's requests as one call), and renaming a
rule set's slot is `POST /presets/rename-param` (rpc `rename-param`; expressions are parsed, so a
string literal is never changed).

## Performance budgets

- Initial JS for `/{org}` ≤ 250 KB gzip. Viewer, Library editors and the comparison grid are
  separate chunks. Per-route budgets are enforced in CI by `npm run bundle:check -w @ifc-boq/app`
  (`apps/app/bundle-budgets.json`).
- Sheet payload (review B-18): the line list carries each line's trace as a summary (its formula, its
  source line, and per element the guid, quantity and model the filters and the viewer need); the line
  detail reads the full trace from `/lines/by-key`. The API gzips JSON. The viewer repaints once per
  frame. Typing in the search still re-renders the sheet per key (about 130 ms at 4,000 lines; a
  debounce with `useDeferredValue` made it worse, 256 ms, and was taken out; N-37).
- Sheet: 60 fps scroll at 20k rows (virtualised rows, fixed row height, no per-row
  subscriptions).
- Lighthouse performance ≥ 80 on the dashboard (warm API).

## Environment

| Variable | Example |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` (proxied in dev to `API_PROXY_TARGET`, default the local Java API on `http://localhost:8080`) |
| `API_PROXY_TARGET` | `http://localhost:8080` (dev default); in production unset, the edge routes `/api/v1` |
| `NEXT_PUBLIC_AUTH_ADAPTER` | `native` (default) \| `keycloak` (rollback, with `NEXT_PUBLIC_KEYCLOAK_*`) |
| `NEXT_DIST_DIR` | build folder override (the Java browser smoke uses `.next-java`) |
| `MODULE_PRICING` | must stay unset; `1` throws until the module exists (P48) |

In dev, the `/api/v1` route handler forwards to the Java API so cookies behave as in production
(same origin). Full list of variables: `docs/development/environment.md`.

## Modules (P36)

Once it exists, the app imports `packages/pricing-ui` in exactly one place (`src/modules.ts`),
and only when the build flag `MODULE_PRICING` is set. Core code never imports from a module;
modules import core components, hooks and the generated core client. A lint rule
(`no-restricted-imports`) forbids `@ifc-boq/pricing-ui` anywhere but `src/modules.ts`. CI builds
the app once (core only); a build with the module is to be added with the module.

The extension points (FE-039) are typed registries in `src/extensions/registry.ts`, read through
`@/extensions` (importing it runs `src/modules.ts` first): `nav.orgItems` (left navigation, after
the core's items), `boq.workspaceTabs` (`?tab=<id>`, after the core's tabs, not on a saved version
opened read-only), `sheet.selectionActions` (in the sheet's bulk bar), `sheet.lineBadges` (a hook
per module, called once per sheet; badges after the line's description), `settings.orgSections`
(`/{org}/settings/{path}`, served by `settings/[section]`), `project.overviewCards`, `area.routes`
(a first URL segment outside any org: next.config rewrites `/{area}/…` to `/areas/{area}/…`, before the
`[org]` segment, for the areas of the modules in the build; `AreaHost` renders the area), `notifications.kinds` (text from the module's namespace). Labels and panels are
components, so a module renders its own namespace and queries. Registering one key twice throws.
`src/extensions/testing/test-module.tsx` registers one entry on every point for the unit tests;
the app never imports it. The build flag `MODULE_PRICING=1` stops the build until the module exists
(P48).
