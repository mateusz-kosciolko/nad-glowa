# Repository Guidelines

Astro 7 SSR app (React 19 islands, Tailwind 4, shadcn/ui) with Supabase Auth, deployed to Cloudflare Workers. Product scope: @context/foundation/prd.md. Stack rationale: @context/foundation/tech-stack.md. Setup: @README.md.

## Hard rules

- Never write to `context/archive/`; archived changes are immutable.
- Read `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY` only via `astro:env/server` (server-only secrets in @astro.config.mjs). Never import them into React components or client scripts.
- Create Supabase clients only with `createClient()` from @src/lib/supabase.ts and handle its `null` return (Supabase not configured), as in @src/pages/api/auth/signin.ts.
- Klient z kluczem `service_role` (`createAdminClient()` z `src/lib/supabase-admin.ts`) omija RLS i wolno go użyć wyłącznie w handlerze `scheduled`, który nie ma sesji użytkownika. Reguły ESLint `no-restricted-imports` / `no-restricted-syntax` blokują wszędzie indziej ten import (także z rozszerzeniem i dynamiczny), `SUPABASE_SERVICE_KEY` z `astro:env/server` oraz `createClient` z `@supabase/supabase-js` — nie wyłączaj ich lokalnym komentarzem. Kod obsługujący żądania użytkownika zawsze używa klucza `anon` i polega na politykach RLS. Jedyny wyjątek poza `src/`: `scripts/smoke.mjs` używa klucza `service_role` lokalnej Supabase przez GoTrue Admin API (zakłada i usuwa konto testowe) i odmawia działania, gdy host `SUPABASE_URL` nie jest lokalny albo klucz nie jest kluczem demo lokalnej Supabase CLI. W `scripts/` pilnuje tego reguła ESLint `no-restricted-syntax` na `process.env.SUPABASE_SERVICE_KEY`.
- Every route requires login unless it is listed in `PUBLIC_ROUTES` in @src/middleware.ts (exact path match); the middleware sets `context.locals.user`. There is no sign-up: accounts are created only by an administrator in the Supabase dashboard (locally, `scripts/smoke.mjs` also creates and deletes its test account via the Admin API).
- `AGENTS.md` is a symlink to `CLAUDE.md`. Edit `CLAUDE.md`, and put project rules outside the `@przeprogramowani/10x-cli` BEGIN/END block, which the CLI manages.

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime; local secrets come from `.dev.vars`.
- `npm run lint` / `npm run lint:fix` — ESLint strict type-checked rules plus Prettier (@eslint.config.js).
- `npx astro sync && npx astro check` — type check, run by CI after lint.
- `npm run build` — SSR build for Cloudflare.
- `npx wrangler deploy` — the only supported deploy command (Workers with Static Assets). Never `wrangler pages deploy` or any other `wrangler pages *` command: they ignore `wrangler.jsonc`, so the deploy silently loses `nodejs_compat` and any cron triggers.
- There is no separate `wrangler dev` step. With `@astrojs/cloudflare` v14, `npm run dev` already runs workerd inside Vite; tutorials recommending `wrangler pages dev ./dist` are obsolete for these pins.
- If the dev server answers 500 with "The file does not exist at …/node_modules/.vite/deps_ssr/… in the optimize deps directory" (seen after running `astro sync` / `build` alongside it), restart `npm run dev`; it is a stale Vite dep cache, not a code error.
- `npm test` — Vitest unit tests (@vitest.config.ts) for pure modules only: `src/lib/**/*.test.ts`, run in Node without workerd or the Astro config, so tested modules must not import `astro:*` or Supabase. Import `describe`/`it`/`expect` explicitly from `vitest`.
- `npm run smoke` — HTTP auth-flow test against a running server (`BASE_URL`, default `http://localhost:4321`); reads `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY` from `.dev.vars`, creates its test account through the local Supabase Admin API and deletes it after the run; refuses to run against a non-local Supabase.
- `npm run cron:local` — fires the Worker's `scheduled` handler every 60 s via `GET /cdn-cgi/handler/scheduled` (`astro dev` never fires Cron Triggers on its own); needs a running `npm run dev` and `SUPABASE_SERVICE_KEY` in `.dev.vars`. The `/__scheduled` path from `context/foundation/infrastructure.md` belongs to `wrangler dev --test-scheduled` and does not exist here.
- `npm run cf:types` — regenerates `worker-configuration.d.ts` (Workers runtime types and `Env`) after changing `wrangler.jsonc` or the variable names in `.dev.vars`; commit the result, CI does not generate it.

Three kinds of automated tests: `npm test` (Vitest unit tests for pure `src/lib` modules), `smoke` (HTTP) and `npm run test:db` (pgTAP permission tests in `supabase/tests/`).

## Structure & conventions

- `src/pages/` — routes; `src/pages/api/` — endpoints exporting uppercase `GET`/`POST` typed as `APIRoute`.
- `src/components/` — `.astro` for static UI; React `.tsx` only for interactive islands (e.g. `src/components/auth/`). No `"use client"` or other Next.js directives.
- `src/components/ui/` — shadcn/ui ("new-york"); add components with `npx shadcn@latest add <name>`.
- `src/lib/` — helpers and services.
- Import from `src` via the `@/` alias (`@/lib/supabase`), not deep relative paths.
- Merge Tailwind classes with `cn()` from @src/lib/utils.ts; do not concatenate class strings.
- Auth endpoints report failures by redirecting back to the form with `?error=<encodeURIComponent(message)>`, not by returning JSON.
- Settings and dashboard endpoints redirect with an error code only (`?error=`, `?telegram_error=`, `?alerts_error=`); pages render it via `messageForCode()` from @src/lib/form-errors.ts, never the raw parameter.

## Commits & CI

- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.
- CI (@.github/workflows/ci.yml) runs on push/PR to `master`: lint → `astro check` → build, plus a smoke job against a local Supabase. Run lint and `astro check` before pushing.
- No git history yet; commit message convention is to be defined.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 5 (10xDevs 4.0 UI)

**W przypadku pracy nad UI w widoku, który już się renderuje, użyj `/10x-ui`.** Przeprowadza ono zmianę wizualną przez ten sam łańcuch co każdą inną zmianę (`/10x-new` → `/10x-research` →
`/10x-plan` → `/10x-implement` → `/10x-impl-review`) i obejmuje zasady:
kiedy rozpocząć pracę i którego widoku dotyczy, audyt pod kątem opłat, kontrakt systemu projektowego w formie, w jakiej realizuje go to repozytorium, stany komponentów, bramkę zrzutu ekranu oraz regułę, która utrzymuje kolejnego agenta przy kontrakcie. W jego `references/` znajduje się lista kontrolna jakości.

Tworzenie widoku po raz pierwszy nie jest zadaniem dla `/10x-ui` — zbuduj go poprzez
zwykły łańcuch, a następnie wróć do niego z `/10x-ui`.

<!-- END @przeprogramowani/10x-cli -->
