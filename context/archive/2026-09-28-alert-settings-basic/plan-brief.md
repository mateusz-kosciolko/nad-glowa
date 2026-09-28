# Podstawowe ustawienia alertów (S-02) — Plan Brief

> Full plan: `context/changes/alert-settings-basic/plan.md`

## What & Why

Zalogowany użytkownik ustawia przybliżoną lokalizację domu (~1 km), promień obserwacji (domyślnie 30 km) i listę kodów typów samolotów, a inni tych danych nigdy nie widzą. To wejście, bez którego north star S-03 (pierwszy alert przed przelotem) nie ma czego dopasować. Pokrywa FR-003, FR-004, FR-005 i Access Control z PRD.

## Starting Point

Schemat `alert_settings` z RLS jest zaprojektowany i zatwierdzony (spec `aba254e`) i ma gotowy SQL oraz testy pgTAP (plan `511ba0a`), ale nic nie jest wdrożone. `supabase/migrations/` nie istnieje. Aplikacja ma tylko logowanie i pusty `/dashboard`. Endpointy formularzy działają przez natywny POST z redirectem `?error=`.

## Desired End State

Na produkcji zalogowany użytkownik wchodzi z dashboardu na `/settings` i widzi swoje ustawienia. Wpisuje współrzędne albo klika „Use my location”, ustawia promień, wpisuje kody typu `b744, a400` i zapisuje. Po przeładowaniu widzi `52.23 / 21.01` i `B744, A400`. Polityki bazy gwarantują, że nie da się odczytać ani zmienić cudzych ustawień, a pgTAP i smoke to dowodzą.

## Key Decisions Made

| Decision               | Choice                                                                                | Why (1 sentence)                                                                       | Source   |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| Model danych i RLS     | Tabela `alert_settings` z `numeric(5,2)`, `icao_type[]`, 2 polityki, trigger          | Zatwierdzony spec; precyzja ~1 km i izolacja są własnościami bazy, nie kodu            | Spec     |
| Granica `service_role` | Poza zakresem (Task 2 z `511ba0a`)                                                    | Roadmapa przypisuje ją do F-02, razem z pollerem                                       | Roadmapa |
| Miejsce ekranu         | Nowa chroniona trasa `/settings`, link z `/dashboard`                                 | S-05 i S-06 rozbudują ten sam ekran; dashboard zostaje na status alertów               | Plan     |
| Lokalizacja            | Pola lat/lon + „Use my location” (zaokrąglone do 2 miejsc w przeglądarce)             | Bez nowych zależności; dokładna pozycja nie opuszcza przeglądarki                      | Plan     |
| Typy samolotów         | Pole tekstowe; serwer przycina, zamienia na wielkie litery, usuwa duplikaty, waliduje | `b744` po prostu działa; minimum UI do wyrzucenia przy S-06                            | Plan     |
| Lat/lon                | Oba albo żadne; serwer nie zaokrągla                                                  | Pół lokalizacji nie ma sensu; zaokrągla typ kolumny                                    | Plan     |
| Zapis                  | Natywny POST do `/api/settings`, redirect `?saved=1` / `?error=`                      | Konwencja endpointów z `CLAUDE.md`; ta sama walidacja w wyspie oszczędza utraty danych | Plan     |
| Weryfikacja            | pgTAP + nowe kroki smoke (uwierzytelniony round-trip)                                 | Pierwszy dowód RLS przez `@supabase/ssr` na workerd                                    | Plan     |
| Produkcja              | W zakresie, jako ostatnia faza z ręczną bramką `supabase link`                        | S-02 jest `done` dopiero na produkcji; hasło bazy zna tylko człowiek                   | Plan     |

## Scope

**In scope:**

- Migracja, testy pgTAP, `test:db` w CI, wygenerowane typy bazy, korekta speca (backfill)
- Moduł walidacji `src/lib/alert-settings.ts`, `POST /api/settings`, typowany `createClient`
- Strona `/settings`, wyspa formularza z geolokacją, ochrona tras, link z dashboardu, kroki smoke
- `db push` i `wrangler deploy` na produkcję, wpis w `deploy-plan.md`

**Out of scope:**

- Reguła ESLint i sekret `service_role` (F-02); czytelny picker i słownik typów (S-06); przełącznik pauzy (S-05)
- Zamknięcie rejestracji i przepięcie smoke z signup (S-01); mapa; zmiana redirectu po logowaniu

## Architecture / Approach

Migracja → `database.types.ts` → `createServerClient<Database>`. Wyspa `AlertSettingsForm` i endpoint `/api/settings` korzystają z tego samego czystego modułu `parseAlertSettingsForm`. Wyspa blokuje wysyłkę przy błędzie, serwer ma ostatnie słowo. Endpoint robi `update … eq(user_id)` kluczem `anon` pod RLS, a strona `/settings` czyta wiersz przez `maybeSingle()`. Na produkcji baza idzie przed Workerem.

## Phases at a Glance

| Phase                       | What it delivers                                                 | Key risk                                                           |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Schemat i testy bazy     | Tabela z RLS lokalnie, 12 zielonych asercji pgTAP, typy, krok CI | Domena na elementach tablicy niesprawdzona (jest ścieżka awaryjna) |
| 2. Zapis ustawień (backend) | Walidacja + `POST /api/settings` pod RLS, chronione trasy        | Wygenerowane typy vs strict lint                                   |
| 3. Ekran `/settings`        | Formularz z geolokacją, link z dashboardu, smoke z round-tripem  | Smoke zależy od otwartej rejestracji (do przepięcia w S-01)        |
| 4. Produkcja                | Migracja i kod na produkcji, zweryfikowane                       | Kolejność: `db push` przed deployem; migracji nie cofa rollback    |

**Prerequisites:** Docker Desktop uruchomiony; Twoja obecność w fazie 4 (`supabase link` z hasłem bazy i weryfikacja w SQL Editorze).
**Estimated effort:** ~2–3 sesje wieczorne w 4 fazach.

## Open Risks & Assumptions

- Postgres może nie egzekwować domeny `icao_type` na elementach tablicy. Wtedy kolumna staje się `text[]`, a walidację zapewnia moduł aplikacji (plan `511ba0a` Task 1 Step 5).
- Smoke nadal zakłada konto przez `/auth/signup`. S-01 musi dać mu inną ścieżkę, zanim zamknie rejestrację.
- Poprawny format kodu nie znaczy, że typ istnieje: `B745` przejdzie. Słownik typów to S-06.
- CI nie biega, dopóki repo nie ma remote'a. Weryfikacja faz odbywa się lokalnie.

## Success Criteria (Summary)

- Na produkcji użytkownik zapisuje i zmienia lokalizację, promień i typy, a po przeładowaniu widzi wartości zaokrąglone do ~1 km.
- Użytkownik nie może odczytać ani zmienić cudzych ustawień (pgTAP), a niezalogowany nie dostaje się do `/settings`.
- Smoke dowodzi uwierzytelnionego zapisu i odczytu na runtime Cloudflare.
