# Pierwszy alert przed przelotem (S-03) — Plan Brief

> Full plan: `context/changes/first-advance-alert/plan.md`

## What & Why

Cron co minutę przewiduje przeloty samolotów wybranych typów i wysyła na Telegram powiadomienie 2–15 min przed
przelotem w promieniu domu użytkownika. To gwiazda przewodnia kamienia milowego M-1, czyli najmniejszy kawałek
dowieziony od początku do końca, którego działanie dowodzi głównej hipotezy produktu („alert przychodzi ≥ 2 min
przed najbliższym punktem przelotu”). Zmiana wchłania S-04: ta sama maszyna nie wywoła drugiego alertu przez 60 min.

## Starting Point

Działa lokalny cron z heartbeatem (`src/workers/scheduled.ts`, pusty `runWork()`), klient adsb.fi zwracający
surowy stan samolotów (`src/lib/adsb.ts`) i ustawienia z domem, promieniem i typami (`/settings`). Nie ma kanału
powiadomień, predykcji, deduplikacji ani runnera testów jednostkowych.

## Desired End State

Użytkownik zapisuje na `/settings` swój chat ID Telegrama i sprawdza go przyciskiem testowym. Przy działającym
`npm run dev` i `npm run cron:local` dostaje wiadomość z typem, rejestracją, czasem, kierunkiem nadlotu i „Route
unknown”. Samolot już blisko dostaje oznaczenie „already close”. Każdy alert jest zapisany, więc kryterium 2 min da
się sprawdzić zapytaniem.

## Key Decisions Made

| Decision                        | Choice                                                                | Why (1 sentence)                                                                     |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Powiązanie z Telegramem         | Chat ID w `/settings` (kolumna pod RLS) + wiadomość testowa           | Działa dla każdego zaproszonego użytkownika i sprawdza kanał bez czekania na samolot |
| Powtórki                        | Q4 rozstrzygnięte teraz, deduplikacja w S-03 (S-04 wchłonięte)        | Od pierwszego dnia da się tego używać bez spamu                                      |
| Okno deduplikacji               | 60 min od wysłania; ta sama maszyna = `hex` (bez `~`) lub rejestracja | Pokrywa cały przelot wolnej maszyny, a lot powrotny po godzinach znowu da alert      |
| Samolot w promieniu, oddala się | Alert „already close”                                                 | Nie gubi maszyny, którą wciąż widać z balkonu                                        |
| Testy predykcji                 | Vitest dla czystych modułów `src/lib`, krok w CI                      | Geometria ma przypadki brzegowe, których nie widać na stronie                        |
| Promień zapytania               | Promień użytkownika + 15 min przy 600 kt (~278 km)                    | Zapytanie o sam promień widzi tylko samoloty już nad głową                           |
| Treść wiadomości                | Zwykły tekst po angielsku, czas w Europe/Warsaw, link globe.adsb.fi   | Spójne z UI, bez escapowania; link spełnia obowiązek atrybucji adsb.fi               |
| Kolejność wysyłka/zapis         | Najpierw Telegram, potem `alert_notifications`                        | Nieudana wysyłka sama ponowi się w następnym biegu                                   |
| Pauza                           | Poller respektuje istniejące `paused`                                 | Jedna linia; S-05 dołoży tylko UI                                                    |
| Produkcja                       | Bez deployu i migracji na produkcji                                   | Cron działa lokalnie (Open Roadmap Question 10)                                      |

## Scope

**In scope:**

- Vitest, czysta predykcja (`flyover.ts`), deduplikacja i treść wiadomości (`alerts.ts`) z testami
- Kolumna `telegram_chat_id`, pole w formularzu, klient Telegrama, sekret `TELEGRAM_BOT_TOKEN`, przycisk testowy
- Tabela `alert_notifications` (tylko `service_role`), poller wpięty w `runWork()`
- Walidacja na prawdziwym przelocie, aktualizacja roadmapy i `deploy-plan.md`

**Out of scope:**

- Trasy (S-07), UI pauzy (S-05), czytelny wybór typów (S-06), przeglądanie dziennika (FR-011)
- Wdrożenie na produkcję, link `/start` z kodem, automatyczny zapas adsb.lol, retencja dziennika

## Architecture / Approach

`scheduled.ts` (jedyny moduł z klientem `service_role`) przekazuje klienta do `alert-poller.ts`. Poller czyta
aktywne ustawienia i dla każdego użytkownika po kolei (≥ 1,1 s odstępu) pobiera samoloty z adsb.fi w promieniu
zapytania. Dopasowuje je po typie i przepuszcza przez `predictPass`. Kandydatów filtruje przez dziennik
z ostatnich 60 min, wysyła przez `telegram.ts` i zapisuje w `alert_notifications`. Błędy wracają jako podsumowanie
do `cron_runs`, bez współrzędnych, chat ID i tokena.

## Phases at a Glance

| Phase                                  | What it delivers                                            | Key risk                                                  |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 1. Predykcja, deduplikacja i treść     | Vitest + czyste moduły z testami przypadków brzegowych      | Konfiguracja Vitest z aliasem `@/` poza Astro             |
| 2. Kanał Telegram w ustawieniach       | Chat ID na `/settings`, klient Telegrama, wiadomość testowa | Token w URL-u nie może wyciec do komunikatów błędów       |
| 3. Poller z dziennikiem i deduplikacją | Prawdziwe alerty z cronu, bez powtórek, z pauzą             | Limit 1 req/s i blokada IP adsb.fi przy 4xx               |
| 4. Walidacja na żywo i dokumentacja    | Dowód kryterium 2 min, roadmapa i `deploy-plan.md` aktualne | Predykcja po prostej myli się przy skrętach i podejściach |

**Prerequisites:** F-01, F-02 i S-02 zrobione; lokalny Supabase i Docker; bot Telegrama z @BotFather.
**Estimated effort:** ~3–4 sesje w 4 fazach.

## Open Risks & Assumptions

- Strefa czasowa w `Intl` pod workerd nie była sprawdzana; weryfikuje ją faza 4.
- Większy promień zapytania (~310 km) zwraca kilkaset samolotów; zakładamy, że to nadal mała odpowiedź.
- Open Roadmap Question 1 (czy płatne alerty już rozwiązują problem) pozostaje otwarte.

## Success Criteria (Summary)

- Alert o pasującym samolocie przychodzi co najmniej 2 min przed najbliższym punktem przelotu (zapytanie zwraca 0
  naruszeń, a co najmniej jeden alert porównany z rzeczywistym przelotem).
- Ta sama maszyna nie daje drugiego alertu przez 60 min, a pauza wstrzymuje wysyłkę.
- `npm test`, `npm run test:db` i `npm run smoke` przechodzą.
