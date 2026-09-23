---
project: nad-glowa
deployed_at: 2026-09-23
platform: Cloudflare Workers (Static Assets)
worker_name: nad-glowa
production_url: https://nad-glowa.mateusz-kosciolko-321.workers.dev
version_id: 99a7916d-2871-4dc9-85fe-f80f13c5d9c9
status: deployed
---

# Deploy plan — pierwsze wdrożenie na produkcję

Ścieżka audytowa dla „tego, co miało się wydarzyć". Decyzja platformowa: `context/foundation/infrastructure.md`.
Ograniczenia stacka: `context/foundation/tech-stack.md`.

## Co zostało wdrożone

Aplikacja w stanie ze scaffoldu: strona główna, rejestracja/logowanie Supabase (`/auth/signin`,
`/auth/signup`, `/api/auth/*`), chroniony `/dashboard` z middleware ustawiającym `context.locals.user`.
**Brak logiki alertów** — poller ADS-B i predykcja przelotu jeszcze nie istnieją.

|                     |                                                                    |
| ------------------- | ------------------------------------------------------------------ |
| Platforma           | Cloudflare Workers with Static Assets (**nie** Pages)              |
| Nazwa Workera       | `nad-glowa`                                                        |
| URL produkcyjny     | https://nad-glowa.mateusz-kosciolko-321.workers.dev                |
| Aktywny Version ID  | `99a7916d-2871-4dc9-85fe-f80f13c5d9c9`                             |
| Konto Cloudflare    | `mateusz.kosciolko@gmail.com` (`321276ecf944b4a3f73a126d4bbaa3b0`) |
| Plan Cloudflare     | Free                                                               |
| Projekt Supabase    | `nwphfexokrngshgmhucf`, region EU                                  |
| Komenda wdrożeniowa | `npm run build && npx wrangler deploy`                             |

## Podpięte sekrety

Wartości nie są tu zapisane i nigdy nie będą — Workers Secrets są write-only, panel i CLI ich nie pokazują.
Rotacja: ponowne `npx wrangler secret put <NAZWA>` (tworzy nową wersję, bez rebuildu).

| Nazwa          | Gdzie żyje                            | Odczyt w kodzie                            |
| -------------- | ------------------------------------- | ------------------------------------------ |
| `SUPABASE_URL` | Workers Secret + lokalnie `.dev.vars` | `astro:env/server` → `src/lib/supabase.ts` |
| `SUPABASE_KEY` | Workers Secret + lokalnie `.dev.vars` | `astro:env/server` → `src/lib/supabase.ts` |

Użyty jest klucz **`anon` / `public`**, nie `service_role` — ochroną danych jest RLS w Postgresie,
nie tajność klucza. `service_role` obchodzi RLS i nie może trafić do tej aplikacji.

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

Poniżej minuty, bez rebuildu — wersje są niezmiennymi uploadami. To pierwsze wdrożenie, więc wersji
poprzedniej nie ma; punktem odniesienia jest `99a7916d-2871-4dc9-85fe-f80f13c5d9c9`.

**Czego rollback NIE cofa**: migracji Supabase ani wysłanych powiadomień. Migracje pisz addytywnie —
destrukcyjne dopiero wtedy, gdy Worker już nie odwołuje się do kolumny.

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

**Nie uruchamiaj `npm run smoke` przeciwko produkcji.** Skrypt rejestruje prawdziwe konto
`smoke-<timestamp>@example.com` i zakłada wyłączone potwierdzanie e-maila. Smoke zostaje testem
lokalnym i CI-owym przeciwko lokalnej Supabase.

## Czego NIE wdrożono

| Element                                        | Dlaczego nie teraz                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron Trigger `* * * * *` + handler `scheduled` | W repo nie ma jeszcze pollera ADS-B. Cron bez handlera to błąd co minutę. Wejdzie razem z logiką alertów — **wtedy wymagany Workers Paid $5/mo**, bo free capuje crony na 10 ms CPU                                       |
| Auto-deploy z GitHub Actions                   | Repo nie ma remote'a. Wymaga repozytorium GitHub i scoped `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit tylko dla tego projektu, bez DNS i bez rozliczeń)                                                                  |
| Cloudflare Access przed preview URL-ami        | Deploy włączył Preview URLs domyślnie i są publiczne. Do zamknięcia, zanim na produkcji pojawią się prawdziwe lokalizacje domowe — dziś aplikacja ich nie zbiera. Alternatywa: `"preview_urls": false` w `wrangler.jsonc` |
| Migracje Supabase / RLS                        | Brak `supabase/migrations`. Schemat powstaje razem z logiką alertów; RLS jest warunkiem koniecznym, bo klucz `anon` jest publiczny                                                                                        |
| `site` w `astro.config.mjs`                    | Build ostrzega, że integracja sitemap jest pomijana. Uzupełnić produkcyjnym URL-em                                                                                                                                        |
| Własna domena                                  | Na starcie `*.workers.dev`                                                                                                                                                                                                |
