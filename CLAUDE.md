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
- `npm run test:integration` — Vitest integration tests (@vitest.integration.config.ts) for the alert poller: `src/workers/**/*.integration.test.ts`, in Node with only the edges faked (`fetch` per host for adsb.fi, adsbdb and Telegram, plus an in-memory Supabase from `src/workers/poller-fakes.ts`); no network or database. Tested modules must not import `astro:*`; pass the client, clock and token in as parameters.
- `npm run test:hooks` — proof for the agent hooks (@vitest.hooks.config.ts, `scripts/__tests__/agent-hooks.test.mjs`): pipes hook payloads into the real `.claude/hooks/*.sh` in throwaway git repos with stubbed eslint/vitest/astro; ~50 s, so not part of `npm test`. Run it after changing `.claude/hooks/` or the hooks in `.claude/settings.json`.
- Agent hooks (`.claude/settings.json`): after every `Write`/`Edit`, `lint-edited-file.sh` (ESLint on that file, no `--fix`) and `related-tests.sh` (`vitest related` in both configs); on `Stop`, `end-of-turn.sh` lints every changed file, runs `npm test`, `npm run test:integration` and `astro check` (plus `test:hooks` when the hooks changed), and sends the agent back once. They report on exit 2 + stderr only; keep that contract when editing them.
- `npm run smoke` — HTTP auth-flow test against a running server (`BASE_URL`, default `http://localhost:4321`); reads `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY` from `.dev.vars`, creates its test account through the local Supabase Admin API and deletes it after the run; refuses to run against a non-local Supabase.
- `npm run cron:local` — fires the Worker's `scheduled` handler every 60 s via `GET /cdn-cgi/handler/scheduled` (`astro dev` never fires Cron Triggers on its own); needs a running `npm run dev` and `SUPABASE_SERVICE_KEY` in `.dev.vars`. The `/__scheduled` path from `context/foundation/infrastructure.md` belongs to `wrangler dev --test-scheduled` and does not exist here.
- `npm run cf:types` — regenerates `worker-configuration.d.ts` (Workers runtime types and `Env`) after changing `wrangler.jsonc` or the variable names in `.dev.vars`; commit the result, CI does not generate it.

Four kinds of automated tests: `npm test` (Vitest unit tests for pure `src/lib` modules), `npm run test:integration` (alert poller with faked edges), `smoke` (HTTP) and `npm run test:db` (pgTAP permission tests in `supabase/tests/`).

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

## Zestaw narzędzi AI 10xDevs — Moduł 3, Lekcja 1

Rozpocznij Moduł 3 od stworzenia **trwałego, ukierunkowanego na ryzyko kontraktu jakości** przed napisaniem jakiegokolwiek testu — następnie prowadź każdą fazę wdrożenia przez standardowy łańcuch zmian.

```
PRD + roadmap + archive
        │
        ▼
   /10x-test-plan  ──►  context/foundation/test-plan.md  (strategia §1–§5 zamrożona + cookbook §6 się rozwija)
        │
        ▼  (jedna faza wdrożenia naraz, /clear między przekazaniami)
   /10x-new ──► /10x-research ──► /10x-plan ──► /10x-implement
```

`/10x-test-plan` to **stanowy orkiestrator**, a nie generator jednorazowy. Przy pierwszym uruchomieniu zapisuje etapowe wdrożenie do `context/foundation/test-plan.md`. Przy każdym kolejnym uruchomieniu ponownie wyprowadza stan z artefaktów na dysku i prezentuje następne przekazanie. Lekcja skupia się na **strategii i sekwencjonowaniu wdrożenia, a nie konfiguracji**. Hooki, serwery MCP i CI YAML są konfigurowane w późniejszych lekcjach tego modułu.

### Router zadań — od czego zacząć

| Umiejętność | Użyj, gdy |
| --- | --- |
| **Strategia jakości jako plik reguł (temat lekcji)** | |
| `/10x-test-plan` | Masz PRD (a najlepiej także roadmapę i kilka zarchiwizowanych fragmentów) i zaraz napiszesz pierwsze testy projektu albo zauważyłeś, że testy generowane przez AI trafiają w helpery, podczas gdy krytyczne przepływy pozostają niepokryte. Pierwsze wywołanie uruchamia discovery (PRD + roadmap + archive + skan hot spotów), 5-pytaniowy wywiad z użytkownikiem oraz etap syntezy z obowiązkową kontrolą challengera, a następnie zapisuje `test-plan.md` w `context/foundation/` z mapą ryzyk (5–7 scenariuszy awarii), tabelą etapowego wdrożenia, tabelą stosu, tabelą bramek jakości, sekcją cookbook (`§6`, uzupełnianą w miarę dostarczania faz) oraz sekcją negatywnej przestrzeni (czego celowo nie testujemy). Kolejne wywołania przesuwają wdrożenie o jedno przekazanie naraz. |
| `/10x-test-plan --status` | `test-plan.md` już istnieje i chcesz uzyskać zwięzły obraz stanu wdrożenia — które fazy mają status `not started`, `change opened`, `researched`, `planned`, `implementing` lub `complete`, oraz jaka jest następna akcja. Nie wykonuje pracy; można bezpiecznie uruchomić w dowolnym momencie. |
| `/10x-test-plan --refresh` | `test-plan.md` już istnieje i wystąpiło jedno z następujących: nowe ryzyko z top 3 pojawiło się w roadmapie lub archive, data `checked:` narzędzia jest starsza niż trzy miesiące, stos technologiczny projektu się zmienił albo negatywna przestrzeń §7 nie odpowiada już temu, co uważa zespół. Otwiera nowy folder zmiany `test-plan-refresh-<YYYY-MM-DD>` zamiast edytować przewodnik w miejscu. |

### Łańcuch wdrożenia — co dzieje się po zapisaniu przewodnika

Tabela §3 *Phased Rollout* przewodnika jest stanem orkiestratora. Dla każdego wiersza, który nie ma statusu `complete`, orkiestrator wybiera następne przekazanie na podstawie istniejących artefaktów w `context/changes/<change-id>/`:

| Stan na dysku | Następne przekazanie | Status przechodzi na |
| --- | --- | --- |
| brak folderu zmiany | `/10x-new <change-id>` | `change opened` |
| tylko `change.md` | `/10x-research` (z opisem ryzyk do zweryfikowania) | `researched` |
| `+ research.md` | `/10x-plan` (z ograniczeniami cost × signal + aktualizacji cookbooka) | `planned` |
| `+ plan.md` z oczekującymi elementami `## Progress` | `/10x-implement <change-id> phase <N>` | `implementing` / `complete` |
| `+ plan.md` w pełni `[x]` | Oznacz wiersz §3 jako `complete`; przejdź w pętli do następnego oczekującego wiersza | — |

Każde przekazanie jest punktem **STOP**. Orkiestrator kopiuje następne polecenie do schowka, prosi użytkownika o wykonanie `/clear` i uruchomienie go, a następnie kończy działanie. Ponownie wywołaj `/10x-test-plan` (bez argumentów), aby przejść dalej.

### Reguły priorytetyzacji zorientowanej na ryzyko

- Ryzyka to **scenariusze awarii w kategoriach użytkownika / biznesu**, a nie nazwy testów. „Wylogowany użytkownik uzyskuje dostęp do płatnej treści przez nieaktualny token” to ryzyko; „przetestuj formularz logowania” nim nie jest.
- Od 5 do 7 ryzyk. Mniej jest zbyt ogólne; więcej czyni priorytetyzację bezużyteczną.
- Wpływ i prawdopodobieństwo są ocenami użytkownika/biznesu, a nie złożoności technicznej.
- Każde ryzyko ma źródło: sekcję PRD, zarchiwizowany fragment, wpis roadmapy, pytanie z wywiadu Fazie 2, katalog hot spotu z liczbą zmian lub ograniczenie stosu technologicznego. Żadnych wymyślonych ryzyk.
- **Sygnał, nie wiedza.** §2 cytuje *dowody, które podniosły ryzyko*, nigdy plik jako „miejsce, gdzie występuje awaria”. Kotwice file:line, nazwy funkcji, nazwy schematów i nazwy modułów są zabronione w §2 — należą do wyniku `/10x-research`, tworzonego dla każdej fazy wdrożenia względem aktualnego kodu. Plan jest specyfikacją QA; nie jest audytem kodu.
- Pokrycie nie jest metryką. Metryką jest **pokrycie ryzyka**.

### Reguły mapowania dwuwarstwowego

- Najpierw warstwa klasyczna: wygrywa najtańszy test dający rzeczywisty sygnał. Awansuj do e2e tylko wtedy, gdy żadna tańsza warstwa nie pokrywa ryzyka.
- Następnie warstwa AI-native i tylko tam, gdzie dodaje sygnał, którego klasyczne testy nie dostarczają tanio.
- Każdy wiersz AI-native ma linię **„When NOT to use”**. Jeśli nie potrafisz jej napisać, usuń wiersz.
- Każda nazwa narzędzia zawiera datę `checked: <YYYY-MM-DD>`. Nazwy narzędzi są przykładami kategorii, a nie rekomendacjami.
- Obie warstwy muszą być niepuste w końcowym przewodniku, jeśli projekt ich wymaga. Tylko klasyczna warstwa to plan z 2020 roku; tylko AI-native to hype. Fazy AI-native nie są obowiązkowe — uwzględniaj je tylko wtedy, gdy brief uzasadnił je w ramach cost × signal.

### Reguły bramek jakości

- Wymagane bramki (lint, typecheck, unit+integration, e2e dla krytycznych przepływów) muszą mapować się na rzeczywiste kroki CI. Jeśli wymagana bramka nie jest jeszcze podłączona, oznacz ją jako `required after §3 Phase <N>` i pozwól wskazanej fazie wdrożenia ją podłączyć.
- Hook po edycji jest **zalecany lokalnie**, a nie substytutem CI.
- Multimodalny przegląd wizualny jest **selektywny**, stosowany do 1–3 krytycznych ekranów, a nie do każdej strony.
- Zapasowe rozwiązanie oparte na wizji (Anthropic Computer Use lub OpenAI CUA) jest zarezerwowane dla powierzchni niedostępnych przez DOM; kosztowne na akcję.

### Wzorce cookbooka (§6) — uzupełniane z czasem

`test-plan.md` jest zarówno etapową strategią, jak i **rosnącym cookbookiem**. §6 zaczyna się od placeholderów (`TBD — see §3 Phase <N>`) i jest uzupełniany stopniowo — plan każdej fazy wdrożenia kończy się podfazą aktualizującą odpowiedni wpis §6 (lokalizacja, nazewnictwo, test referencyjny, polecenie uruchomienia). Po ukończeniu Modułu 3 §6 staje się kanoniczną odpowiedzią na pytanie „jak dodać test dla X w tym projekcie?” — i jest tym, co `/10x-tdd` odczytuje w Lekcji 2.

### Granice lekcji

- Nie pisz kodu testów. To temat Lekcji 2 (`/10x-tdd` i tworzenie testów jednostkowych).
- Nie konfiguruj hooków, cyklu życia hooków ani hooków debugowania. To temat Lekcji 3.
- Nie konfiguruj serwerów MCP, Playwright API, kodu e2e ani kodu scenariuszy multimodalnych. To temat Lekcji 4.
- Nie uruchamiaj przepływu bug-to-fix-to-regression-test. To temat Lekcji 5.
- Nie twórz od podstaw potoków CI/CD ani nie pisz GitHub Actions YAML. Przewodnik wskazuje bramki; konfiguracja należy do Modułu 1 Lekcji 5 i Modułu 2 Lekcji 5.
- Nie porównuj modeli multimodalnych. Cytuj kryteria (cost, latency, agent-friendliness), nigdy ranking.
- Nie czytaj codebase w celu zdobywania wiedzy (grafy wywołań, schematy, „który plik odpowiada za tę awarię”). To zadanie `/10x-research`, wykonywane dla każdej fazy wdrożenia.

### Ścieżki używane przez tę lekcję

- `context/foundation/test-plan.md` — kontrakt jakości tworzony i utrzymywany przez `/10x-test-plan`
- `context/foundation/prd.md` — główne źródło ryzyk
- `context/foundation/roadmap.md` — ważenie prawdopodobieństwa
- `context/foundation/tech-stack.md` — dane wejściowe stosu (gdy obecne)
- `context/archive/<change-id>/plan.md` — zaimplementowana powierzchnia ryzyka
- `context/changes/<change-id>/` — folder zmiany dla każdej fazy wdrożenia (po jednym na wiersz w §3)

<!-- END @przeprogramowani/10x-cli -->
