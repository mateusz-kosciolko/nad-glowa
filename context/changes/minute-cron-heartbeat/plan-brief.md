# Zadanie cykliczne co minutę z heartbeatem — Plan Brief

> Full plan: `context/changes/minute-cron-heartbeat/plan.md`

## What & Why

F-02 z roadmapy: zadanie, które uruchamia się co minutę i przy każdym biegu, także pustym, zostawia ślad w
bazie. Bez tego cisza „brak ciekawych samolotów” z przyszłego S-03 wygląda tak samo jak cisza „zadanie przestało
działać” (ryzyko M/H z `infrastructure.md`). Zadanie działa lokalnie, bo źródła ADS-B odmawiają żądań z
Cloudflare Workers (decyzja z 2026-09-28, Open Roadmap Question 10).

## Starting Point

Worker ma tylko handler `fetch` Astro, bez crona i bez handlera `scheduled`. Lokalny dev działa na lokalnym
Supabase z jedną tabelą `alert_settings` (RLS). Granica klucza `service_role` z planu `511ba0a` (Task 2) jest
zaprojektowana, ale niewdrożona.

## Desired End State

Przy działającym `npm run dev` i `npm run cron:local` handler `scheduled` odpala co minutę i dopisuje wiersz do
`cron_runs`. Dashboard pokazuje „Last cron run: N s ago”, ostrzega po ponad 5 minutach ciszy i pokazuje „No cron
runs yet” na pustej tabeli. Klient `service_role` jest dostępny wyłącznie w handlerze `scheduled`, czego pilnuje
ESLint.

## Key Decisions Made

| Decision                | Choice                                                     | Why (1 sentence)                                                                                | Source  |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| Miejsce działania       | Lokalnie, z sieci użytkownika                              | Oba darmowe źródła ADS-B odmawiają Workerom na produkcji.                                       | Roadmap |
| Środowisko uruchomienia | Handler `scheduled` Workera w `src/worker.ts`              | Zgodne z tech-stack, planem `511ba0a` i hard rules; produkcja to później dopisanie crona.       | Plan    |
| Postać heartbeatu       | Wiersz na bieg w `cron_runs`, retencja 7 dni               | Widać przerwy (np. wyłączony komputer), a S-03 dopisze liczbę samolotów do tego samego wiersza. | Plan    |
| Widoczność              | Karta na dashboardzie + linia logu na bieg, próg 5 min     | Ciszę widać tam, gdzie użytkownik i tak patrzy; próg z rejestru ryzyk `infrastructure.md`.      | Plan    |
| Lokalny zegar           | `npm run cron:local` wołający `/cdn-cgi/handler/scheduled` | Widoczny i przenośny, bez konfiguracji systemowej; `/__scheduled` nie działa w `astro dev`.     | Plan    |
| Zapis bez sesji         | Klient `service_role` tylko w `src/workers/scheduled.ts`   | Handler nie ma sesji użytkownika; granica ESLint z `511ba0a` wyprzedza pierwszy import.         | Roadmap |

## Scope

**In scope:**

- Własny entrypoint Workera (`fetch` + `scheduled`) i typy Workers
- `src/lib/supabase-admin.ts`, sekret `SUPABASE_SERVICE_KEY`, reguła ESLint, hard rule w `CLAUDE.md`
- Tabela `cron_runs` z RLS, test pgTAP, zapis biegu z retencją 7 dni
- `npm run cron:local`, karta na dashboardzie, dokumentacja uruchomienia

**Out of scope:**

- Pobieranie ADS-B, predykcja i powiadomienia (S-03)
- Cron w `wrangler.jsonc`, Workers Paid, sekrety produkcyjne (Parked)
- Zewnętrzny monitoring uptime, launchd/crontab, konfigurowalne progi

## Architecture / Approach

`src/worker.ts` eksportuje `{ fetch: handle, scheduled: handleScheduled }`. `handle` pochodzi z
`@astrojs/cloudflare/handler`, a `handleScheduled` z `src/workers/scheduled.ts`. Lokalnie `npm run cron:local`
co 60 s wywołuje `GET /cdn-cgi/handler/scheduled` na dev serverze. Handler wykonuje pracę biegu (w F-02 pustą;
tu wepnie się S-03), zapisuje wiersz `ok`/`error` przez `createAdminClient()` i usuwa wiersze starsze niż 7 dni.
Dashboard czyta ostatni wiersz zwykłym klientem z sesją (polityka RLS `select` dla zalogowanych).

## Phases at a Glance

| Phase                                      | What it delivers                                               | Key risk                                                                  |
| ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Entrypoint `scheduled` i granica klucza | Handler odpalany curlem w dev, granica `service_role` w ESLint | Zmiana `main` dotyka każdego żądania; typy Workers mogą kolidować z Astro |
| 2. Ślad biegów i lokalny zegar             | `cron_runs` z RLS i retencją, `npm run cron:local`             | Błąd zapisu nie może przerwać handlera ani dev servera                    |
| 3. Dashboard i dokumentacja                | „Last cron run”, ostrzeżenie po 5 min, instrukcja w README     | Granica 5 min (dokładnie 5 min to jeszcze świeży bieg)                    |

**Prerequisites:** lokalny Supabase (`npx supabase start`) i klucz `service_role` z `npx supabase status` w
`.dev.vars`.
**Estimated effort:** ~2 sesje, 3 fazy.

## Open Risks & Assumptions

- Ścieżka `/cdn-cgi/handler/scheduled` jest odczytana z kodu vite pluginu 1.54.8, nieprzetestowana; faza 1
  weryfikuje ją jako pierwszą.
- Typy runtime z `wrangler types` mogą kolidować z typami DOM; fallback to `--include-runtime=false` i minimalne
  deklaracje w `src/env.d.ts`.
- Zadanie działa tylko, gdy komputer i oba procesy są włączone; heartbeat to pokaże, ale nie zapobiegnie.

## Success Criteria (Summary)

- Co minutę w `cron_runs` pojawia się nowy wiersz, a wpisy starsze niż 7 dni znikają.
- Dashboard odróżnia „zadanie żyje” od „brak biegu od ponad 5 minut” i od „nigdy nie było biegu”.
- Import klienta `service_role` poza handlerem `scheduled` nie przechodzi lintu.
