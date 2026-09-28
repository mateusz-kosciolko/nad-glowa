# Zadanie cykliczne co minutę z heartbeatem — plan implementacji

## Overview

F-02 z roadmapy (`minute-cron-heartbeat`). Aplikacja dostaje handler `scheduled` Cloudflare Workers obok Astro.
Lokalnie odpala go co minutę skrypt `npm run cron:local`. Każdy bieg, także pusty, zapisuje wiersz w tabeli
`cron_runs`, a dashboard pokazuje, kiedy był ostatni bieg. Dzięki temu cisza „brak ciekawych samolotów” (S-03)
będzie odróżnialna od ciszy „zadanie nie działa albo komputer był wyłączony”. Przy okazji wchodzi granica klucza
`service_role` zaprojektowana w planie `511ba0a` (Task 2), bo handler bez sesji użytkownika to jej pierwszy
konsument.

## Current State Analysis

- Worker ma tylko handler `fetch` Astro: `wrangler.jsonc` → `"main": "@astrojs/cloudflare/entrypoints/server"`,
  a ten plik to `export default { fetch: handle }` (`node_modules/@astrojs/cloudflare/dist/entrypoints/server.js:1-4`).
- Brak crona w `wrangler.jsonc` i brak handlera `scheduled` (`context/deployment/deploy-plan.md:140`).
- Pobieranie ADS-B z Workera na produkcji jest zablokowane (adsb.fi 403, adsb.lol 429). Decyzja z 2026-09-28:
  F-02 i S-03 działają lokalnie (`context/foundation/roadmap.md`, Open Roadmap Question 10;
  `context/foundation/adsb-source.md`).
- Lokalny dev działa na lokalnym Supabase (`.dev.vars` wskazuje na localhost). Jedyna tabela to
  `alert_settings` z RLS (`supabase/migrations/20260928084032_alert_settings.sql`).
- Granica klucza `service_role` (Task 2 z `docs/superpowers/plans/2026-09-24-alert-settings-rls.md:337`) nie jest
  wdrożona. W `eslint.config.js` nie ma reguły `no-restricted-imports`, a `CLAUDE.md` nie ma hard rule o
  `createAdminClient()`. Roadmapa przypisuje tę granicę do F-02.
- W projekcie nie ma globalnych typów Workers (`ExportedHandler`, `ScheduledController`, `ExecutionContext`).
  `handler.d.ts` adaptera ich używa, ale `skipLibCheck` to ukrywa.
- Brak runnera testów jednostkowych. Są `npm run smoke` (HTTP) i `npm run test:db` (pgTAP,
  `supabase/tests/alert_settings_rls.sql`).

## Desired End State

Przy działającym `npm run dev` i `npm run cron:local` handler `scheduled` uruchamia się co minutę. Każdy bieg
dopisuje wiersz do `cron_runs` (start, czas trwania, `ok`/`error`, opcjonalny komunikat) i usuwa wiersze
starsze niż 7 dni. Dashboard zalogowanego użytkownika pokazuje „Last cron run: N s ago”. Po ponad 5 minutach
bez biegu pojawia się ostrzeżenie, a gdy biegu nigdy nie było — stan „brak biegów”. Klient `service_role`
istnieje wyłącznie w `src/lib/supabase-admin.ts`, a ESLint odrzuca jego import wszędzie poza
`src/workers/scheduled.ts`. Produkcja się nie zmienia: bez crona w `wrangler.jsonc` handler `scheduled` na
Workerze nigdy nie odpala.

### Key Discoveries:

- Adapter v14 zachowuje własny `main` (`node_modules/@astrojs/cloudflare/dist/wrangler.js:36`) i eksportuje
  `handle` z `@astrojs/cloudflare/handler` (`package.json` exports `./handler`). Wzorzec „custom entrypoint” jest
  w dokumentacji Astro (docs.astro.build, integrations-guide/cloudflare).
- W `astro dev` crony nie odpalają same. Vite plugin wystawia `/cdn-cgi/handler/scheduled` (przepisywane na
  `/cdn-cgi/local/scheduled`, `node_modules/@cloudflare/vite-plugin/dist/index.mjs:84669-84700`), a miniflare
  przyjmuje `?cron=` (`node_modules/miniflare/dist/src/workers/core/entry.worker.js:4077`). `/__scheduled` z
  `infrastructure.md` dotyczy tylko `wrangler dev --test-scheduled` i tutaj nie działa.
- `astro:env/server` jest wypełniane przy imporcie `@astrojs/cloudflare/handler` (`setGetEnv` w
  `handler.js:1,31`), więc działa też w `scheduled`. Sekrety czytać w funkcji, nie na poziomie modułu.
- Wzorzec pgTAP: `supabase/tests/alert_settings_rls.sql`. Wzorzec skryptu bez zależności z `BASE_URL`:
  `scripts/smoke.mjs:4`.

## What We're NOT Doing

- Pobierania ADS-B, predykcji ani powiadomień — to S-03. Heartbeat nie zapisuje jeszcze liczby samolotów.
- Crona `triggers.crons` w `wrangler.jsonc`, planu Workers Paid ani sekretu `SUPABASE_SERVICE_KEY` w Workers
  Secrets — wdrożenie produkcyjne jest odłożone (`## Parked` w roadmapie).
- Zewnętrznego monitoringu uptime i powiadomień o ciszy — tylko widok na dashboardzie.
- Uruchamiania przez launchd/crontab — tylko `npm run cron:local`.
- Konfigurowalnego progu ciszy ani retencji — stałe 5 min i 7 dni w kodzie.

## Implementation Approach

Kolejność idzie od granicy bezpieczeństwa do UI. Reguła ESLint powstaje, zanim `supabase-admin.ts` istnieje
(jak w Tasku 2), żeby wyprzedzić pierwszy import. Handler `scheduled` żyje w `src/workers/scheduled.ts`, jedynym
module, któremu wolno użyć klienta `service_role`. `src/worker.ts` tylko skleja `fetch` Astro z tym handlerem.
Zapis biegu jest owinięty tak, że błąd pracy biegu też zostawia wiersz (`status: error`). Błąd samego zapisu
kończy się logiem w konsoli, nie wyjątkiem.

## Critical Implementation Details

- **Timing & lifecycle** — `src/worker.ts` musi importować `@astrojs/cloudflare/handler` na poziomie modułu, bo
  dopiero ten import wypełnia `astro:env/server`. `createAdminClient()` czyta sekrety w chwili wywołania.
- **Debug & observability** — lokalny wyzwalacz to `GET http://localhost:4321/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`.
  Działa tylko w dev (`unsafeTriggerHandlers` w vite pluginie), na produkcji ta ścieżka nie istnieje.

## Faza 1: Entrypoint `scheduled` i granica klucza serwisowego

### Overview

Worker eksportuje `fetch` i `scheduled`. Granica `service_role` jest wymuszona przez ESLint i opisana w
`CLAUDE.md`. Handler na razie tylko loguje bieg; zapis do bazy przychodzi w fazie 2.

### Changes Required:

#### 1. Reguła ESLint granicy klucza

**File**: `eslint.config.js`

**Intent**: Zablokować import klienta `service_role` w całym `src/` z wyjątkiem handlera `scheduled`, zanim ten
klient powstanie. Treść i kolejność konfiguracji jak w Tasku 2 planu `511ba0a`.

**Contract**: nowe `serviceKeyBoundary` (`files: src/**/*.{ts,tsx,astro}`, `no-restricted-imports` na
`**/supabase-admin` i `@/lib/supabase-admin`) oraz `schedulerConfig` (wyłącza regułę dla
`src/workers/scheduled.ts` i `src/lib/supabase-admin.ts`). Oba wpięte po `scriptsConfig`, przed
`eslintPluginPrettier`. Weryfikacja próbką `src/lib/__eslint-probe.ts`, kasowaną po sprawdzeniu.

#### 2. Klient `service_role`

**File**: `src/lib/supabase-admin.ts`, `astro.config.mjs`, `.env.example`

**Intent**: Jedyne miejsce tworzące klienta z kluczem, który omija RLS, dla kodu bez sesji użytkownika.

**Contract**: `createAdminClient(): SupabaseClient<Database> | null`. Zwraca `null`, gdy brak `SUPABASE_URL` lub
`SUPABASE_SERVICE_KEY`; bez utrwalania sesji i bez odświeżania tokenu. `SUPABASE_SERVICE_KEY` to nowe
`envField.string({ context: "server", access: "secret", optional: true })`. `.env.example` dostaje
`SUPABASE_SERVICE_KEY=###`.

#### 3. Typy Workers

**File**: `worker-configuration.d.ts` (generowany), `package.json`, `eslint.config.js`, `.prettierignore`

**Intent**: Dać `src/worker.ts` typy `ExportedHandler`, `ScheduledController`, `ExecutionContext` i `Env`, które
przejdą `astro check` w CI.

**Contract**: skrypt `cf:types` → `wrangler types`. Plik jest commitowany (CI go nie generuje), ignorowany przez
ESLint i Prettier jak `database.types.ts`. `wrangler types` zapisuje tylko nazwy zmiennych z `.dev.vars`, nie
wartości — sprawdzić to przed commitem. Generować po dopisaniu `SUPABASE_SERVICE_KEY` do `.dev.vars`, żeby plik
był stabilny. Kolejność prób: (1) `wrangler types` (z typami runtime) i `astro check`; (2) jeśli globalne typy
workerd kolidują z DOM (tsconfig nie ustawia `lib`, więc oba są obecne), `wrangler types --include-runtime=false`
(sam `Env`) plus minimalne deklaracje `ScheduledController`, `ExecutionContext` i `ExportedHandler` w
`src/env.d.ts`, ograniczone do tego, czego używa `src/worker.ts`. `@cloudflare/workers-types` nie jest fallbackiem,
bo nakłada te same globale.

#### 4. Handler `scheduled` i entrypoint

**File**: `src/workers/scheduled.ts`, `src/worker.ts`, `wrangler.jsonc`

**Intent**: Dodać handler `scheduled` bez zmiany zachowania `fetch`. W tej fazie handler loguje jedną linię z
czasem i wyrażeniem crona.

**Contract**: `src/workers/scheduled.ts` eksportuje
`handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>`.
`src/worker.ts` eksportuje `default { fetch: handle, scheduled: handleScheduled } satisfies ExportedHandler<Env>`,
z `handle` z `@astrojs/cloudflare/handler`. `wrangler.jsonc` → `"main": "./src/worker.ts"`, bez `triggers`.

#### 5. Reguła w `CLAUDE.md` i `deploy-plan.md`

**File**: `CLAUDE.md` (sekcja `## Hard rules`, poza blokiem 10x-cli), `context/deployment/deploy-plan.md`

**Intent**: Zapisać granicę tak, żeby następny agent jej nie obszedł, i poprawić zdanie „`service_role` nie może
trafić do tej aplikacji”.

**Contract**: hard rule z Tasku 2 (krok 6) plus dopisanie `SUPABASE_SERVICE_KEY` do reguły o czytaniu sekretów
przez `astro:env/server`. W `deploy-plan.md` tekst z Tasku 2 (krok 7), z poprawką, że sekret istnieje lokalnie w
`.dev.vars`, a w Workers Secrets nie (produkcja odłożona), oraz nowy wiersz w tabeli „Podpięte sekrety”. Wiersz
crona (`deploy-plan.md:140`) odsyła do decyzji z Question 10.

### Success Criteria:

#### Automated Verification:

- Próbka `src/lib/__eslint-probe.ts` importująca `@/lib/supabase-admin` jest odrzucona przez `npx eslint` z komunikatem o `service_role`, a po jej skasowaniu `npm run lint` przechodzi
- Typy i build przechodzą: `npx astro sync && npx astro check` oraz `npm run build`
- Przy działającym `npm run dev` wywołanie `curl -s -o /dev/null -w "%{http_code}" "http://localhost:4321/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"` zwraca 200, a konsola dev pokazuje linię logu biegu
- `npm run smoke` przechodzi na działającym `npm run dev` (fetch Astro bez regresji)
- Zbudowany worker działa jak w CI: `npm run build`, potem `npm run preview -- --port 4321` i `npm run smoke` przechodzi

#### Manual Verification:

- `worker-configuration.d.ts` nie zawiera wartości sekretów z `.dev.vars`, tylko nazwy
- Strony `/`, `/auth/signin`, `/dashboard` i `/settings` działają w przeglądarce jak przed zmianą

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 2.

---

## Faza 2: Ślad biegów i lokalny zegar

### Overview

Tabela `cron_runs`, zapis wiersza przy każdym biegu, retencja 7 dni i skrypt odpalający handler co minutę.

### Changes Required:

#### 1. Migracja `cron_runs`

**File**: `supabase/migrations/<timestamp>_cron_runs.sql` (przez `npx supabase migration new cron_runs`)

**Intent**: Trwały ślad każdego biegu, czytelny dla zalogowanych, zapisywalny tylko przez `service_role`.

**Contract**: tabela `public.cron_runs`: `id bigint generated always as identity primary key`,
`started_at timestamptz not null`, `duration_ms integer not null check (duration_ms >= 0)`,
`status text not null check (status in ('ok', 'error'))`, `error text` (null przy `ok`), indeks na
`started_at desc`. `revoke all` z `anon` i `authenticated`, `grant select` dla `authenticated`, RLS włączone,
jedna polityka `select to authenticated using (true)`. Tabela nie zawiera danych użytkowników, więc odczyt dla
wszystkich zalogowanych jest bezpieczny. Komentarze w SQL po polsku, jak w migracji `alert_settings`.

#### 2. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Typowany dostęp do `cron_runs`.

**Contract**: regeneracja przez `npm run db:types` po zastosowaniu migracji, bez ręcznej edycji.

#### 3. Zapis biegu i retencja

**File**: `src/workers/scheduled.ts`, `src/lib/cron-runs.ts`

**Intent**: Każdy bieg zostawia dokładnie jeden wiersz, także gdy praca biegu rzuci wyjątek. Brak konfiguracji
albo błąd zapisu kończy się logiem, nie wyjątkiem z handlera.

**Contract**: `src/lib/cron-runs.ts` eksportuje `CRON_RUN_RETENTION_DAYS = 7` i czysty typ wiersza biegu. Handler
mierzy czas, wykonuje pracę biegu (w F-02 pustą; S-03 wpina się w to miejsce), wstawia wiersz przez
`createAdminClient()`, potem usuwa wiersze ze `started_at` starszym niż 7 dni i loguje jedną linię z wynikiem.
Gdy `createAdminClient()` zwraca `null`, loguje ostrzeżenie o braku `SUPABASE_SERVICE_KEY` i kończy.

#### 4. Test RLS

**File**: `supabase/tests/cron_runs_rls.sql`

**Intent**: Zablokować regresję uprawnień w stylu `alert_settings_rls.sql`.

**Contract**: pgTAP: tabela istnieje, RLS włączone, dokładnie jedna polityka, `authenticated` czyta,
`authenticated` nie może `insert`/`delete`, `anon` nie może `select`.

#### 5. Lokalny zegar

**File**: `scripts/cron-local.mjs`, `package.json`, `eslint.config.js`

**Intent**: Odpalać handler co 60 s, dopóki działa terminal, i pokazywać, kiedy wywołanie się nie udało (np. dev
nie działa).

**Contract**: skrypt bez zależności z `BASE_URL` (domyślnie `http://localhost:4321`), jak `scripts/smoke.mjs`.
Pierwsze wywołanie od razu, potem co 60 s `GET /cdn-cgi/handler/scheduled?cron=*+*+*+*+*`, jedna linia logu na
wywołanie (czas, status HTTP lub błąd sieci), bez przerywania pętli przy błędzie. Skrypt `cron:local` w
`package.json`. `scriptsConfig` w `eslint.config.js` dostaje brakujące globale (`setInterval`, `Date`, jeśli
potrzebne).

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na lokalnej bazie bez resetu danych: `npx supabase migration up`
- Testy bazy przechodzą, w tym nowy `cron_runs_rls.sql`: `npm run test:db`
- `npm run db:types` generuje typy z `cron_runs`, a `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą

#### Manual Verification:

- Przy `npm run dev` i `npm run cron:local` działających przez 3 minuty w `cron_runs` (Supabase Studio) przybywa po jednym wierszu `ok` na minutę
- Po zatrzymaniu `npm run dev` skrypt `cron:local` loguje błąd i działa dalej, a po ponownym starcie dev biegi wracają
- Bez `SUPABASE_SERVICE_KEY` w `.dev.vars` bieg loguje ostrzeżenie i nie przerywa dev servera
- Wiersz ze `started_at` wstawionym ręcznie 8 dni wstecz znika po następnym biegu

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 3.

---

## Faza 3: Widoczność na dashboardzie i dokumentacja

### Overview

Dashboard pokazuje świeżość ostatniego biegu. Dokumentacja opisuje, jak uruchomić zadanie lokalnie.

### Changes Required:

#### 1. Ocena świeżości

**File**: `src/lib/cron-runs.ts`

**Intent**: Jedna czysta funkcja decydująca, co pokazać, żeby próg nie był rozsiany po UI.

**Contract**: `HEARTBEAT_STALE_AFTER_MS = 5 * 60_000` oraz
`describeLastRun(lastStartedAt: string | null, now: Date): { state: "never" } | { state: "fresh" | "stale"; ageSeconds: number }`.
`stale` wtedy i tylko wtedy, gdy wiek jest większy niż 5 min (dokładnie 5 min to jeszcze `fresh`).

#### 2. Karta na dashboardzie

**File**: `src/pages/dashboard.astro`

**Intent**: Pokazać zalogowanemu, czy zadanie żyje, w miejscu, na które i tak patrzy.

**Contract**: odczyt ostatniego wiersza `cron_runs` (`started_at`, `status`) przez `createClient()` z obsługą
`null`. Stany i teksty (UI jest po angielsku): `fresh` → „Last cron run: N s ago” (lub minuty przy ≥ 120 s),
`stale` → to samo plus ostrzeżenie „No run for over 5 minutes — is `npm run cron:local` running?”, `never` →
„No cron runs yet”, `status = error` ostatniego biegu → dopisek „(last run failed)”. Klasy przez `cn()`.

#### 3. Dokumentacja

**File**: `CLAUDE.md` (sekcja `## Commands`), `README.md`

**Intent**: Następna osoba lub agent wie, jak uruchomić i zweryfikować zadanie lokalnie.

**Contract**: w `CLAUDE.md` komenda `npm run cron:local` (odpala `scheduled` co minutę przez
`/cdn-cgi/handler/scheduled`; wymaga `npm run dev`) i `npm run cf:types`, plus uwaga, że `/__scheduled` z
`infrastructure.md` tu nie działa. W `README.md` w sekcji Supabase: skopiowanie `service_role key` z
`npx supabase status` do `.dev.vars` jako `SUPABASE_SERVICE_KEY` oraz opis `cron:local` w „Available Scripts”.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro sync && npx astro check` i `npm run build` przechodzą
- `npm run smoke` przechodzi na działającym `npm run dev`

#### Manual Verification:

- Przy działającym `cron:local` dashboard pokazuje „Last cron run: N s ago” z N poniżej 60
- Po zatrzymaniu `cron:local` na ponad 5 minut dashboard pokazuje ostrzeżenie o braku biegów
- Na pustej tabeli `cron_runs` dashboard pokazuje „No cron runs yet”
- Instrukcja z README pozwala od zera uzupełnić `.dev.vars` i zobaczyć pierwszy bieg

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych w projekcie. Granicę `describeLastRun` (dokładnie 5 min → `fresh`,
  5 min + 1 s → `stale`, `null` → `never`) sprawdzić ręcznie na dashboardzie albo jednorazowym wywołaniem w
  trakcie implementacji; nie dodajemy runnera w tej zmianie.

### Integration Tests:

- pgTAP `supabase/tests/cron_runs_rls.sql` dla uprawnień.
- `npm run smoke` na każdej fazie, bo zmiana entrypointu dotyka każdego żądania.

### Manual Testing Steps:

1. `npx supabase start`, uzupełnij `SUPABASE_SERVICE_KEY` w `.dev.vars`, `npm run dev`.
2. W drugim terminalu `npm run cron:local`; po 3 minutach w Studio są 3 nowe wiersze `ok`.
3. Zaloguj się, otwórz `/dashboard` i sprawdź „Last cron run”.
4. Zatrzymaj `cron:local` na 6 minut i odśwież dashboard — ostrzeżenie.

## Performance Considerations

1440 wierszy dziennie i ~10 tys. przy retencji 7 dni — pomijalne dla lokalnego Postgresa. Usuwanie po indeksie
`started_at` przy każdym biegu jest tanie. Odczyt na dashboardzie to jedno zapytanie z `limit 1` po indeksie.

## Migration Notes

Migracja jest addytywna i nie dotyka `alert_settings`. Na lokalnej bazie stosować `npx supabase migration up`,
nie `db reset`, żeby nie stracić kont i ustawień. Na produkcyjnym Supabase migracja nie jest potrzebna, dopóki
zadanie nie działa na produkcji.

## References

- Roadmapa: `context/foundation/roadmap.md` (F-02, Open Roadmap Question 10, `## Parked`)
- Decyzja o uruchamianiu lokalnym: `context/foundation/adsb-source.md`
- Granica klucza `service_role`: `docs/superpowers/plans/2026-09-24-alert-settings-rls.md:337` (Task 2),
  `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`
- Ryzyko cichej awarii i heartbeat: `context/foundation/infrastructure.md:99`
- Wzorzec migracji i RLS: `supabase/migrations/20260928084032_alert_settings.sql`
- Wzorzec pgTAP: `supabase/tests/alert_settings_rls.sql`
- Wzorzec skryptu: `scripts/smoke.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Entrypoint scheduled i granica klucza serwisowego

#### Automated

- [x] 1.1 Próbka importu supabase-admin odrzucona przez ESLint, po skasowaniu npm run lint przechodzi
- [x] 1.2 npx astro sync && npx astro check oraz npm run build przechodzą
- [x] 1.3 curl na /cdn-cgi/handler/scheduled zwraca 200 i konsola dev loguje bieg
- [x] 1.4 npm run smoke przechodzi na npm run dev
- [x] 1.7 npm run build, npm run preview i npm run smoke przechodzą jak w CI

#### Manual

- [x] 1.5 worker-configuration.d.ts zawiera tylko nazwy sekretów, bez wartości
- [x] 1.6 Strony /, /auth/signin, /dashboard i /settings działają jak przed zmianą

### Phase 2: Ślad biegów i lokalny zegar

#### Automated

- [ ] 2.1 npx supabase migration up stosuje migrację bez resetu danych
- [ ] 2.2 npm run test:db przechodzi z cron_runs_rls.sql
- [ ] 2.3 npm run db:types, npm run lint, astro check i npm run build przechodzą

#### Manual

- [ ] 2.4 Przez 3 minuty z cron:local przybywa jeden wiersz ok na minutę
- [ ] 2.5 Po zatrzymaniu dev cron:local loguje błąd i działa dalej, po starcie biegi wracają
- [ ] 2.6 Bez SUPABASE_SERVICE_KEY bieg loguje ostrzeżenie i nie przerywa dev
- [ ] 2.7 Wiersz sprzed 8 dni znika po następnym biegu

### Phase 3: Widoczność na dashboardzie i dokumentacja

#### Automated

- [ ] 3.1 npm run lint, astro check i npm run build przechodzą
- [ ] 3.2 npm run smoke przechodzi na npm run dev

#### Manual

- [ ] 3.3 Dashboard pokazuje Last cron run z N poniżej 60 przy działającym cron:local
- [ ] 3.4 Po ponad 5 minutach bez cron:local dashboard pokazuje ostrzeżenie
- [ ] 3.5 Na pustej cron_runs dashboard pokazuje No cron runs yet
- [ ] 3.6 Instrukcja z README pozwala od zera uzupełnić .dev.vars i zobaczyć pierwszy bieg
