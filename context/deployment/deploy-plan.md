---
project: nad-glowa
deployed_at: 2026-09-28
platform: Cloudflare Workers (Static Assets)
worker_name: nad-glowa
production_url: https://nad-glowa.mateusz-kosciolko-321.workers.dev
version_id: 67f7e569-9798-4a5b-b236-e448d39db000
status: deployed-probe-blocked
---

# Deploy plan — pierwsze wdrożenie na produkcję

Ścieżka audytowa dla „tego, co miało się wydarzyć". Decyzja platformowa: `context/foundation/infrastructure.md`.
Ograniczenia stacka: `context/foundation/tech-stack.md`.

## Co zostało wdrożone

2026-09-23 — aplikacja w stanie ze scaffoldu: strona główna, rejestracja/logowanie Supabase (`/auth/signin`,
`/auth/signup`, `/api/auth/*`), chroniony `/dashboard` z middleware ustawiającym `context.locals.user`.

2026-09-28 — zmiana `alert-settings-basic`: chroniony ekran `/settings` (lokalizacja domowa lat/lon
zaokrąglana przez `numeric(5,2)` do ~1 km, promień domyślnie 30 km, typy samolotów jako kody ICAO)
z endpointem `POST /api/settings` i linkiem z `/dashboard`. `PROTECTED_ROUTES`: `/dashboard`, `/settings`,
`/api/settings`. Na produkcyjnej Supabase migracja `supabase/migrations/20260928084032_alert_settings.sql`
(`npx supabase db push`, `--dry-run` wcześniej pokazał tylko ten plik): tabela `public.alert_settings` z RLS
(polityki select + update dla `authenticated`; insert/delete brak, odebrane też na poziomie grantów), trigger
`on_auth_user_created` → `public.handle_new_user()` (security definer) oraz backfill istniejących kont.

2026-09-28 — zmiana `adsb-source-verified`: klient ADS-B `src/lib/adsb.ts` (adsb.fi domyślnie, adsb.lol jako
zapas) i chroniona sonda diagnostyczna `GET /api/adsb/probe` (JSON bez współrzędnych, parametr `?source=adsb.lol`).
`PROTECTED_ROUTES` poszerzone o `/api/adsb`. Stopka „Aircraft data: adsb.fi” z linkiem do `https://adsb.fi`
na każdej stronie (warunek atrybucji adsb.fi). Pierwsze wdrożenie: `f3e7fff6-…`. Drugie, diagnostyczne:
`67f7e569-…` — błąd sondy dla odpowiedzi innych niż 2xx zawiera `upstream: { server, cfRay, retryAfter, bodyStart }`.
Bez zmian w bazie.

**Brak logiki alertów** — poller ADS-B i predykcja przelotu jeszcze nie istnieją; ustawienia są zapisywane,
ale nic ich jeszcze nie czyta. Oba źródła ADS-B odmawiają żądań z produkcyjnego Workera
(`context/foundation/adsb-source.md`).

|                     |                                                                    |
| ------------------- | ------------------------------------------------------------------ |
| Platforma           | Cloudflare Workers with Static Assets (**nie** Pages)              |
| Nazwa Workera       | `nad-glowa`                                                        |
| URL produkcyjny     | https://nad-glowa.mateusz-kosciolko-321.workers.dev                |
| Aktywny Version ID  | `67f7e569-9798-4a5b-b236-e448d39db000`                             |
| Konto Cloudflare    | `mateusz.kosciolko@gmail.com` (`321276ecf944b4a3f73a126d4bbaa3b0`) |
| Plan Cloudflare     | Free                                                               |
| Projekt Supabase    | `nwphfexokrngshgmhucf`, region EU                                  |
| Komenda wdrożeniowa | `npm run build && npx wrangler deploy`                             |

## Przed następnym wdrożeniem

Zmiana `first-advance-alert` (2026-10-05, jeszcze niewdrożona) dodała dwie migracje, których nie ma na
produkcyjnej Supabase: `supabase/migrations/20261005113514_alert_settings_telegram.sql` (kolumna
`telegram_chat_id` w `alert_settings`) i `supabase/migrations/20261005132125_alert_notifications.sql` (tabela
`public.alert_notifications`, tylko `service_role`). **Przed kolejnym `npx wrangler deploy` trzeba je wypchnąć**
(`npx supabase db push`, wcześniej `--dry-run`), bo `/settings` w obecnym kodzie czyta `telegram_chat_id`
i bez migracji przestanie działać. Kolejność: najpierw migracje, potem deploy — migracje są addytywne,
więc obecna wersja Workera działa z nimi bez zmian. `--dry-run` prawdopodobnie pokaże też dwie migracje
`cron_runs` z `minute-cron-heartbeat` (`20260928180224`, `20260929065324`), które nie trafiły na produkcję,
bo cron działa lokalnie; są addytywne i można je wypchnąć razem z powyższymi.

`TELEGRAM_BOT_TOKEN` istnieje tylko lokalnie w `.dev.vars`; w Workers Secrets go nie ma. Na produkcji
sekret jest opcjonalny, dopóki poller nie jest tam wdrożony (Open Roadmap Question 10).

## Podpięte sekrety

Wartości nie są tu zapisane i nigdy nie będą — Workers Secrets są write-only, panel i CLI ich nie pokazują.
Rotacja: ponowne `npx wrangler secret put <NAZWA>` (tworzy nową wersję, bez rebuildu).

| Nazwa                  | Gdzie żyje                                          | Odczyt w kodzie                                                                               |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`         | Workers Secret + lokalnie `.dev.vars`               | `astro:env/server` → `src/lib/supabase.ts`                                                    |
| `SUPABASE_KEY`         | Workers Secret + lokalnie `.dev.vars`               | `astro:env/server` → `src/lib/supabase.ts`                                                    |
| `SUPABASE_SERVICE_KEY` | tylko lokalnie `.dev.vars` (w Workers Secrets brak) | `astro:env/server` → `src/lib/supabase-admin.ts`                                              |
| `TELEGRAM_BOT_TOKEN`   | tylko lokalnie `.dev.vars` (w Workers Secrets brak) | `astro:env/server` → `src/workers/alert-poller.ts`, `src/pages/api/settings/telegram-test.ts` |

Użyty jest klucz **`anon` / `public`**, nie `service_role` — ochroną danych jest RLS w Postgresie,
nie tajność klucza. `service_role` obchodzi RLS. Decyzją z 2026-09-24 trafi do tej aplikacji jako osobny
sekret `SUPABASE_SERVICE_KEY`, ale wyłącznie dla handlera `scheduled`, który nie ma
sesji użytkownika i musi czytać ustawienia wszystkich kont. Granicy pilnuje reguła
ESLint `no-restricted-imports` (patrz `CLAUDE.md`). Od zmiany `minute-cron-heartbeat` sekret jest zadeklarowany
w `astro.config.mjs` i istnieje lokalnie w `.dev.vars`; w Workers Secrets go nie ma, bo wdrożenie crona
na produkcję jest odłożone (Open Roadmap Question 10).
Szczegóły: `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`.

## Zmiany w repo wykonane przed wdrożeniem

1. `context/foundation/tech-stack.md` — `deployment_target`: `cloudflare-pages` → `cloudflare-workers`.
   Adapter `@astrojs/cloudflare` v14 usunął wsparcie Pages; stara wartość kierowała agenta na
   `wrangler pages deploy`, który „udaje sukces", ignorując `wrangler.jsonc`.
2. `wrangler.jsonc` — `name`: `10x-astro-starter` → `nad-glowa`.
3. `CLAUDE.md` — dwie reguły w `## Commands`: `wrangler deploy` jako jedyna komenda wdrożeniowa
   (`wrangler pages *` zabronione) oraz brak osobnego kroku `wrangler dev` przy adapterze v14.

Weryfikacja przed deployem: `npm run lint` czysty, `npx astro check` 0 błędów / 0 ostrzeżeń (29 plików),
`npm run build` OK.

## Rollback

```bash
npx wrangler rollback                          # poprzednia wersja
npx wrangler versions deploy <version-id>      # konkretna wersja
npx wrangler deployments list                  # historia
```

Poniżej minuty, bez rebuildu — wersje są niezmiennymi uploadami. Aktywna jest
`67f7e569-9798-4a5b-b236-e448d39db000` (2026-09-28, sonda ADS-B z diagnostyką `upstream` + stopka). Poprzednie:
`f3e7fff6-07a7-43f6-aadd-5a84afd8a9ac` (2026-09-28, sonda bez diagnostyki + stopka),
`32455abe-e7eb-4c06-8587-09c98ca5612d` (2026-09-28, `/settings`), `146f9abe-61c7-42b3-a3a7-98fd104e45fd`
(scaffold z wyłączonymi Preview URLs). Wcześniejsza: `99a7916d-2871-4dc9-85fe-f80f13c5d9c9` (pierwsze wdrożenie,
jeszcze z włączonymi Preview URLs). Rollback do `32455abe-…` usuwa sondę i stopkę bez skutków ubocznych.

**Czego rollback NIE cofa**: migracji Supabase ani wysłanych powiadomień. Migracje pisz addytywnie —
destrukcyjne dopiero wtedy, gdy Worker już nie odwołuje się do kolumny. Po rollbacku do `146f9abe-…`
tabela `alert_settings` (i trigger `on_auth_user_created`) zostaje w bazie, ale stary kod jej nie używa.

## Granica dostępu do produkcji

Agent może bez pytania: `wrangler deploy`, `wrangler tail`, `wrangler deployments list`,
`wrangler versions upload`, `wrangler rollback`.

Człowiek wykonuje ręcznie: usunięcie Workera lub projektu, rotację klucza Supabase, drop/reset bazy,
zmianę planu rozliczeniowego, tworzenie i poszerzanie tokenów API, zakładanie kont.

## Weryfikacja

Read-only checki na produkcji (nie tworzą danych):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://nad-glowa.mateusz-kosciolko-321.workers.dev/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://nad-glowa.mateusz-kosciolko-321.workers.dev/dashboard
```

Oczekiwane: `200` dla `/`, `302` → `/auth/signin` dla `/dashboard`. Drugi wynik jest realnym testem —
dowodzi, że `src/middleware.ts` i `@supabase/ssr` wystartowały na workerd. To właśnie tam objawia się
klasa błędu _„dynamic require of stream is not supported"_, i to na deployu, nie na buildzie.

Logi: `npx wrangler tail --format pretty` (`observability.enabled: true` jest ustawione).

Wynik z 2026-09-23: `/` → 200, `/dashboard` (anonim) → 302 na `/auth/signin`, `/auth/signin` i `/auth/signup` → 200,
static assets → 200, baner „Supabase nie jest skonfigurowany" nieobecny, edge `cf-ray: …-WAW`.
Ręcznie w przeglądarce potwierdzone logowanie kontem z panelu Supabase i wyrenderowany `/dashboard` —
czyli `@supabase/ssr` przechodzi na workerd pełny round-trip cookies, nie tylko start.

Wynik z 2026-09-28 (wersja `32455abe-…`): `/` → 200, `/settings` (anonim) → 302 na `/auth/signin`,
`POST /api/settings` (anonim) → 302 na `/auth/signin`, baner „Supabase nie jest skonfigurowany" nieobecny.

Wynik z 2026-09-28 (wersje `f3e7fff6-…` i `67f7e569-…`): `/api/adsb/probe` (anonim) → 302 na `/auth/signin`,
`/` → 200, stopka „Aircraft data: adsb.fi” z linkiem obecna w HTML. Sonda wywołana przez zalogowanego użytkownika
**nie przeszła**: adsb.fi → 502 z `httpStatus: 403` (strona blokady Cloudflare, 5–10 ms), adsb.lol → 502
z `httpStatus: 429` (limit nginx źródła, ~120–160 ms), powtarzalnie w obu wersjach. Z sieci lokalnej ten sam kod
dostaje 200 z obu źródeł. Dowody i interpretacja: `context/foundation/adsb-source.md` („Dostępność z produkcji”).

**Nie uruchamiaj `npm run smoke` przeciwko produkcji.** Skrypt rejestruje prawdziwe konto
`smoke-<timestamp>@example.com` i zakłada wyłączone potwierdzanie e-maila. Smoke zostaje testem
lokalnym i CI-owym przeciwko lokalnej Supabase.

## Czego NIE wdrożono

| Element                      | Dlaczego nie teraz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron Trigger `* * * * *`     | Handler `scheduled` jest w repo (`src/worker.ts` → `src/workers/scheduled.ts`), ale `wrangler.jsonc` nie ma `triggers`, więc na Workerze nigdy nie odpala. **Decyzja z 2026-09-28 (Open Roadmap Question 10)**: pobieranie ADS-B i zadanie cykliczne działają lokalnie, z sieci użytkownika (`npm run dev` + wyzwalacz `/cdn-cgi/handler/scheduled`), bo oba źródła (adsb.fi 403, adsb.lol 429) odmawiają żądań z Workerów (`context/foundation/adsb-source.md`). Wdrożenie na serwer jest w `## Parked` roadmapy — **wtedy wymagany Workers Paid $5/mo** (free capuje crony na 10 ms CPU) i `SUPABASE_SERVICE_KEY` w Workers Secrets |
| Auto-deploy z GitHub Actions | Repo nie ma remote'a. Wymaga repozytorium GitHub i scoped `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit tylko dla tego projektu, bez DNS i bez rozliczeń)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ~~Publiczne Preview URLs~~   | **Zamknięte 2026-09-23**: `"preview_urls": false` w `wrangler.jsonc`. Worker wystawia wyłącznie trasę workers.dev. Konsekwencja: weryfikacja przed promocją odbywa się lokalnie, nie przez publiczny URL wersji                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~Migracje Supabase / RLS~~  | **Częściowo zamknięte 2026-09-28**: `alert_settings` z RLS na produkcji; pozostają tabele powiadomień (FR-009/FR-010) i logu obserwacji (FR-011). RLS jest warunkiem koniecznym dla każdej nowej tabeli, bo klucz `anon` jest publiczny                                                                                                                                                                                                                                                                                                                                                                                               |
| `site` w `astro.config.mjs`  | Build ostrzega, że integracja sitemap jest pomijana. Uzupełnić produkcyjnym URL-em                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Własna domena                | Na starcie `*.workers.dev`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
