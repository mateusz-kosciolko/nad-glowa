<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Zadanie cykliczne co minutę z heartbeatem

- **Plan**: context/changes/minute-cron-heartbeat/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run on 2026-09-29: lint, astro check (0/0/0), build, `test:db` (2 files, 19 tests), ESLint probe,
scheduled trigger (200) and smoke on dev — all PASS (smoke/trigger after a dev restart, see F8). All 19 Progress rows
`[x]` with SHA.

## Findings

### F1 — Granicę klucza service_role da się obejść

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js:99
- **Detail**: Reguła łapie `@/lib/supabase-admin` (także w .astro), ale nie `@/lib/supabase-admin.ts`, `../lib/supabase-admin.js`, dynamiczny `import()` ani `import { SUPABASE_SERVICE_KEY } from "astro:env/server"` + `createClient` z `@supabase/supabase-js` w dowolnej trasie. Hard rule w CLAUDE.md obiecuje blokadę „wszędzie indziej”.
- **Fix**: Rozszerzyć regułę: group `["**/supabase-admin", "**/supabase-admin.*"]`, `paths` dla `astro:env/server` (`importNames: ["SUPABASE_SERVICE_KEY"]`) i dla `@supabase/supabase-js` (`createClient`), z wyjątkiem tylko dla `src/lib/supabase-admin.ts`.
  - Strength: Zamyka realną ścieżkę pomyłki; tylko konfiguracja lintu.
  - Tradeoff: Trzeba sprawdzić, czy `src/lib/supabase.ts` nie importuje `@supabase/supabase-js` w sposób objęty regułą.
  - Confidence: HIGH — obejścia potwierdzone przez `eslint --stdin`.
  - Blind spot: Dynamiczny import wymagałby dodatkowo `no-restricted-syntax`.
- **Decision**: FIXED — reguła rozszerzona o `**/supabase-admin.*`, `paths` dla `SUPABASE_SERVICE_KEY` i `createClient`, `no-restricted-syntax` dla dynamicznego importu; 6/6 próbek obejść odrzuconych, uprawnione importy przechodzą; hard rule w CLAUDE.md zaktualizowana

### F2 — Kolumna `error` w cron_runs czytelna dla każdego zalogowanego

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260928180224_cron_runs.sql:30
- **Detail**: `using (true)` + `grant select` na całą tabelę udostępnia przez PostgREST kolumnę `error`. Po wpięciu S-03 komunikat błędu może zawierać dane innego użytkownika (PRD: lokalizacja wrażliwa). Dashboard czyta tylko `started_at, status`.
- **Fix**: Nowa migracja: `revoke select` + `grant select (id, started_at, duration_ms, status)` dla authenticated; test pgTAP, że `error` jest niedostępne.
- **Decision**: FIXED — migracja `20260929065324_cron_runs_hide_error.sql` (grant kolumnowy bez `error`), test pgTAP „zalogowany nie czyta kolumny error” (break-check: czerwony z oddanym grantem); dashboard nadal pokazuje „Last cron run”

### F3 — createAdminClient() poza try w handlerze „który nigdy nie rzuca”

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/workers/scheduled.ts:25
- **Detail**: Zniekształcony `SUPABASE_URL` sprawia, że `createClient` rzuca, co przeczy komentarzowi „Never throws”.
- **Fix**: Przenieść wywołanie do bloku try albo poprawić komentarz.
- **Decision**: FIXED — `createAdminClient()` w try; błąd klienta kończy się logiem `skipped run … Supabase client failed`

### F4 — cron:local pisze „OK” także przy nieudanym zapisie

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/cron-local.mjs:15
- **Detail**: Handler nigdy nie rzuca, więc każdy tick to HTTP 200; błąd zapisu widać tylko w logu dev.
- **Fix**: Zmienić etykietę „OK” na „invoked” i wskazać log dev.
- **Decision**: FIXED — etykieta `invoked` zamiast `OK` i wskazówka, że wynik biegu jest w logu dev

### F5 — Test pgTAP nie sprawdza constraintów ani braku update

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/cron_runs_rls.sql
- **Detail**: `alert_settings_rls.sql` testuje checki (23514); nowy test nie obejmuje `error_only_on_failure`, `status in (...)` ani update przez authenticated (42501).
- **Fix**: Dodać 3 przypadki `throws_ok`.
- **Decision**: FIXED — 3 nowe przypadki throws_ok (ok+error → 23514, nieznany status → 23514, update → 42501); test:db 23/23, break-check (zdjęty constraint → FAIL)

### F6 — Nieplanowana konfiguracja astro-preview w .claude/launch.json

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .claude/launch.json:10
- **Detail**: Dodane dla bramki 1.7, poza planem; port 4321 jak `astro-dev`, więc nie działają równocześnie.
- **Fix**: Zostawić i odnotować w planie jako uzupełnienie albo usunąć.
- **Decision**: ACCEPTED — konfiguracja zostaje; uzupełnienie opisane w Notes w change.md

### F7 — Karta na produkcji podpowiada komendę deweloperską

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:67
- **Detail**: Na wdrożonym Workerze cron z założenia nie działa (Parked), więc karta pokaże „No cron runs yet” albo radę `npm run cron:local`.
- **Fix**: Przyjąć jako znane ryzyko do czasu wdrożenia produkcyjnego.
- **Decision**: ACCEPTED — produkcja poza zakresem M-1 (Parked); wrócić przy wdrożeniu pollera na serwer

### F8 — Dev zwracał 500 po astro sync/build (cache optymalizatora Vite)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: node_modules/.vite/deps_ssr (środowisko)
- **Detail**: Przy powtórce bramek dev zwracał 500 „file does not exist … handler-\*.js in the optimize deps directory”. Restart dev naprawił (smoke PASS, trigger 200); ponowna próba odtworzenia nie powiodła się.
- **Fix**: Dopisać do CLAUDE.md: przy tym błędzie zrestartuj `npm run dev`.
- **Decision**: FIXED — wskazówka o restarcie dev przy nieaktualnym cache Vite dopisana do `## Commands` w CLAUDE.md
