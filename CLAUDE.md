# Repository Guidelines

Astro 7 SSR app (React 19 islands, Tailwind 4, shadcn/ui) with Supabase Auth, deployed to Cloudflare Workers. Product scope: @context/foundation/prd.md. Stack rationale: @context/foundation/tech-stack.md. Setup: @README.md.

## Hard rules

- Never write to `context/archive/`; archived changes are immutable.
- Read `SUPABASE_URL` / `SUPABASE_KEY` only via `astro:env/server` (server-only secrets in @astro.config.mjs). Never import them into React components or client scripts.
- Create Supabase clients only with `createClient()` from @src/lib/supabase.ts and handle its `null` return (Supabase not configured), as in @src/pages/api/auth/signin.ts.
- To require login for a page, add its path prefix to `PROTECTED_ROUTES` in @src/middleware.ts; the middleware sets `context.locals.user`.
- `AGENTS.md` is a symlink to `CLAUDE.md`. Edit `CLAUDE.md`, and put project rules outside the `@przeprogramowani/10x-cli` BEGIN/END block, which the CLI manages.

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime; local secrets come from `.dev.vars`.
- `npm run lint` / `npm run lint:fix` — ESLint strict type-checked rules plus Prettier (@eslint.config.js).
- `npx astro sync && npx astro check` — type check, run by CI after lint.
- `npm run build` — SSR build for Cloudflare.
- `npx wrangler deploy` — the only supported deploy command (Workers with Static Assets). Never `wrangler pages deploy` or any other `wrangler pages *` command: they ignore `wrangler.jsonc`, so the deploy silently loses `nodejs_compat` and any cron triggers.
- There is no separate `wrangler dev` step. With `@astrojs/cloudflare` v14, `npm run dev` already runs workerd inside Vite; tutorials recommending `wrangler pages dev ./dist` are obsolete for these pins.
- `npm run smoke` — HTTP auth-flow test against a running server (`BASE_URL`, default `http://localhost:4321`); needs Supabase with email confirmation disabled.

No unit test runner is configured; `smoke` is the only automated test.

## Structure & conventions

- `src/pages/` — routes; `src/pages/api/` — endpoints exporting uppercase `GET`/`POST` typed as `APIRoute`.
- `src/components/` — `.astro` for static UI; React `.tsx` only for interactive islands (e.g. `src/components/auth/`). No `"use client"` or other Next.js directives.
- `src/components/ui/` — shadcn/ui ("new-york"); add components with `npx shadcn@latest add <name>`.
- `src/lib/` — helpers and services.
- Import from `src` via the `@/` alias (`@/lib/supabase`), not deep relative paths.
- Merge Tailwind classes with `cn()` from @src/lib/utils.ts; do not concatenate class strings.
- Auth endpoints report failures by redirecting back to the form with `?error=<encodeURIComponent(message)>`, not by returning JSON.

## Commits & CI

- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.
- CI (@.github/workflows/ci.yml) runs on push/PR to `master`: lint → `astro check` → build, plus a smoke job against a local Supabase. Run lint and `astro check` before pushing.
- No git history yet; commit message convention is to be defined.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 3

Przejrzyj kod wygenerowany przez AI przed scaleniem, korzystając z **łańcucha przeglądu implementacji**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` jest głównym tematem lekcji. Przegląd jest bramką jakości, a nie poleceniem naprawienia każdego znaleziska.

### Router zadań — od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| **Przegląd kodu (główny temat lekcji)** | |
| `/10x-impl-review <change-id>` | Zaimplementowano kod i chcesz przeprowadzić ustrukturyzowany przegląd przed scaleniem. Umiejętność sprawdza zgodność z planem, dyscyplinę zakresu, bezpieczeństwo i jakość, architekturę, spójność wzorców oraz kryteria sukcesu, a następnie przedstawia ustalenia do selekcji. |
| **Wynik powtarzającej się lekcji** | |
| `/10x-lesson` | Ustalenie ujawnia powtarzającą się regułę projektu lub wzorzec błędów agenta. Zapisz je w `context/foundation/lessons.md` zamiast traktować je jako jednorazową notatkę. |

### Dyscyplina selekcji

- Dotkliwość określa, jak poważne jest ustalenie. Wpływ określa, jak duże znaczenie ma teraz decyzja.
- Prawidłowe wyniki: napraw teraz, napraw inaczej, pomiń, zaakceptuj jako ryzyko, zapisz jako powtarzającą się regułę (`/10x-lesson`), nie zgódź się.
- Naprawiaj krytyczne ustalenia. Nie poświęcaj godzin na obserwacje o niskim wpływie tylko dlatego, że agent je znalazł.
- Świadome pomijanie ustaleń o niskim wpływie jest prawidłowym wynikiem przeglądu, a nie zaniedbaniem.
- Jeśli nie zgadzasz się z ustaleniem, zapisz dlaczego. Błędne rozumowanie agenta również jest sygnałem.

### Granice przeglądu

- Ta lekcja dotyczy przeglądu zaimplementowanego kodu. Nie tworzy planu, nie wykonuje nowych faz ani nie uczy przeglądu CI.
- Strategia testowania i bramki jakości zostaną wprowadzone w Module 3.
- Nie używaj `/10x-contract` jako wyniku selekcji w tej lekcji.

### Ścieżki używane przez tę lekcję

- `context/changes/<change-id>/plan.md` — oczekiwany kontrakt implementacji
- `context/changes/<change-id>/reviews/` — wynik przeglądu
- `context/foundation/lessons.md` — powtarzające się lekcje

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozwiązana ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: "Ta zmiana jest zarchiwizowana. Zamiast tego otwórz nową zmianę za pomocą `/10x-new`."

<!-- END @przeprogramowani/10x-cli -->
