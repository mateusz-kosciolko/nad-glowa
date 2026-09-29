<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Zadanie cykliczne co minutę z heartbeatem

- **Plan**: context/changes/minute-cron-heartbeat/plan.md
- **Mode**: Deep
- **Date**: 2026-09-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

6/6 paths ✓, 4/4 symbols ✓, brief↔plan ✓, Progress↔Faza ✓ (6/7/6 rows). Sub-agent confirmed: custom `main` is
used in `astro dev` and `preview` (`@astrojs/cloudflare/dist/wrangler.js:36`,
`@cloudflare/vite-plugin/dist/index.mjs:63590-63611`); `/cdn-cgi/handler/scheduled` reaches `scheduled` bypassing
Astro middleware (`index.mjs:84684-84703`); `@/` and `astro:env/server` resolve in the entry's imports; `wrangler
types` writes only variable names from `.dev.vars`; no other references to the old entrypoint.

## Findings

### F1 — Typy runtime Workers mogą wywrócić astro check całego projektu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 1, zmiana 3 (Typy Workers)
- **Detail**: `wrangler types` domyślnie generuje pełne typy runtime workerd (globalne Request/Response/fetch), a tsconfig nie ustawia `lib`, więc DOM też jest obecny i globalne typy się nakładają. `skipLibCheck` ukrywa błędy tylko w `.d.ts`. Fallback z planu (`@cloudflare/workers-types`) ma ten sam problem. Brak ścieżki, gdy oba zawiodą (`wrangler-dist/cli.js:197783-197794`).
- **Fix**: Kolejność w fazie 1: (1) `wrangler types` + astro check; (2) przy konfliktach z DOM `wrangler types --include-runtime=false` plus minimalne deklaracje ScheduledController / ExecutionContext / ExportedHandler w `src/env.d.ts`. Plik generować po dopisaniu `SUPABASE_SERVICE_KEY` do `.dev.vars`.
  - Strength: Deterministyczna ścieżka; wariant (2) nie dotyka globalnych typów.
  - Tradeoff: Ręczne deklaracje do utrzymania przy nowych API Workers.
  - Confidence: MED — skutek potwierdzi dopiero astro check.
  - Blind spot: Nie uruchomiono astro check z wygenerowanym plikiem.
- **Decision**: FIXED

### F2 — Brak weryfikacji entrypointu na `npm run preview`, którego używa CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1, Success Criteria
- **Detail**: Job smoke w CI (`ci.yml:50-55`) testuje zbudowany worker przez `npm run preview`; plan uruchamia smoke tylko na `npm run dev`, więc błąd buildu entrypointu wyjdzie dopiero w CI.
- **Fix**: Dodać do fazy 1 kryterium automatyczne `npm run build`, `npm run preview -- --port 4321`, `npm run smoke` (nowy wiersz Progress 1.7).
- **Decision**: FIXED
