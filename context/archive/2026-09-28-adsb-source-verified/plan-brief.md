# Zweryfikowane źródło danych ADS-B (F-01) — Plan Brief

> Full plan: `context/changes/adsb-source-verified/plan.md`

## What & Why

Wybieramy darmowe źródło ADS-B dla alertu S-03 i potwierdzamy je empirycznie. Dla okolicy domu źródło ma podawać typ samolotu, identyfikator maszyny, pozycję, kurs i prędkość. Ma też odpowiadać produkcyjnemu Workerowi na IP Cloudflare. Bez typu w danych reguła biznesowa w ogóle nie działa, dlatego to ryzyko sprawdzamy przed jakąkolwiek logiką alertu. Rozstrzyga to Open Roadmap Question 2 i odblokowuje S-03 i S-06.

## Starting Point

W kodzie nie ma nic, co pobiera dane lotów. Ustawienia z S-02 (dom z dokładnością ~1 km, promień 1–100 km, kody typów zgodne z `^[A-Z0-9]{2,4}$`) są zapisywane, ale nic ich nie czyta. Produkcja działa na planie Free, bez crona. Research wskazał adsb.fi i adsb.lol jako źródła z typem `t` w danych, ale zapytania szły z sandboxa, nie z IP Cloudflare.

## Desired End State

Decyzja „adsb.fi jako źródło podstawowe, adsb.lol jako zapasowe” jest zapisana w `context/foundation/adsb-source.md`, razem z liczbami z pomiaru i wynikiem z produkcji. Typowany klient `src/lib/adsb.ts` czeka na S-03. Na produkcji zalogowany użytkownik otwiera `/api/adsb/probe` i widzi, ile samolotów źródło widzi teraz wokół jego domu i jaki odsetek ma typ. Współrzędne nigdzie w odpowiedzi nie wracają.

## Key Decisions Made

| Decision              | Choice                                                                                | Why (1 sentence)                                                                          | Source   |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| Źródło                | adsb.fi podstawowe, adsb.lol zapasowe (ten sam format, wybór parametrem `source`)     | Jawny limit 1 req/s i jasne warunki; zamiana źródła to jedna stała                        | Plan     |
| Odrzucone             | OpenSky, airplanes.live, ADS-B Exchange                                               | Brak typu i blokady IP chmurowych / dostęp tylko po zgodzie mailowej / brak darmowego API | Research |
| Failover              | Bez automatycznego przełączania w kodzie                                              | Dwa dodatkowe tryby awarii do testowania, zanim istnieje poller                           | Plan     |
| Weryfikacja produkcji | Chroniony `GET /api/adsb/probe`, zostaje jako diagnostyka                             | Tylko produkcja wychodzi z IP Cloudflare; S-03 dostaje gotowe narzędzie do debugowania    | Plan     |
| Zakres pomiaru        | Pola, zgodność kodów typów, świeżość, samoloty wojskowe, pokrycie tras w adsbdb       | Zamyka też ryzyko mapowania typów z S-02 i niewiadomą o trasach z S-07                    | Plan     |
| Kod                   | Typowany klient `AircraftState` / `fetchAircraftNear`, który nigdy nie rzuca          | S-03 dostaje sprawdzony kontrakt danych zamiast zaczynać od zera                          | Plan     |
| Prywatność            | Sonda zwraca same liczniki i identyfikatory maszyn; pomiar tylko dla centrum Warszawy | Lokalizacja domu jest w PRD daną wrażliwą                                                 | Plan     |
| Atrybucja             | Stopka „Aircraft data: adsb.fi” z linkiem na każdej stronie                           | Wymóg warunków adsb.fi od pierwszego użycia danych                                        | Research |
| Płatna konkurencja    | Poza zakresem (PRD Q1 zostaje otwarte)                                                | Decyzja użytkownika: F-01 zostaje czysto techniczne                                       | Plan     |

## Scope

**In scope:**

- `scripts/adsb-measure.mjs` + `npm run adsb:measure` + `measurement.md` z wynikiem
- `src/lib/adsb.ts`, `GET /api/adsb/probe`, `/api/adsb` w `PROTECTED_ROUTES`, krok smoke dla anonima, stopka z atrybucją
- `wrangler deploy`, sonda z produkcji dla obu źródeł, `adsb-source.md`, wpis w `deploy-plan.md`, adnotacje w roadmapie

**Out of scope:**

- Cron, Workers Paid, heartbeat (F-02); predykcja i powiadomienia (S-03); deduplikacja (S-04)
- Słownik typów (S-06); trasa w alercie (S-07); automatyczny failover; sprawdzenie płatnej konkurencji (PRD Q1); flaga wojskowa w UI

## Architecture / Approach

Najpierw pomiar: skrypt bez zależności, surowe dane z obu źródeł przez około 30 minut, bramka go/no-go. Potem `src/lib/adsb.ts`: URL źródła (promień w milach morskich), `fetch` z timeoutem i `User-Agent`, zawężenie typu z `unknown`, a na końcu `AircraftState[]` albo `ok: false`. Sonda czyta ustawienia pod RLS, woła klienta i zwraca podsumowanie. Na produkcji ta sama sonda sprawdza oba źródła z IP Cloudflare.

## Phases at a Glance

| Phase                       | What it delivers                                                 | Key risk                                                             |
| --------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Pomiar empiryczny źródeł | Liczby: pokrycie typu, zgodność kodów, świeżość, trasy; bramka   | Próg niespełniony → zatrzymanie i rewizja PRD                        |
| 2. Klient ADS-B i sonda     | `src/lib/adsb.ts`, chroniona sonda, smoke, atrybucja             | Strict type-checked lint przy parsowaniu `unknown`                   |
| 3. Produkcja i decyzja      | Sonda na produkcji, `adsb-source.md`, `deploy-plan.md`, roadmapa | adsb.fi odrzuca IP Cloudflare → zamiana na adsb.lol; oba → eskalacja |

**Prerequisites:** lokalna Supabase (Docker) do smoke w fazie 2; Twoja obecność przy bramkach i przy zalogowanym wywołaniu sondy na produkcji.
**Estimated effort:** ~1–2 sesje wieczorne; faza 1 zawiera ~30 minut samego pomiaru.

## Open Risks & Assumptions

- Nikt jeszcze nie sprawdził dostępu z IP Cloudflare. Wyjaśni to dopiero faza 3.
- adsb.lol zapowiada obowiązkowy klucz API, a adsb.fi może zablokować IP przy nadmiarze odpowiedzi 4xx. Żadne ze źródeł nie ma SLA.
- Kształt odpowiedzi `routeset` z adsb.lol jest niepotwierdzony. Pokrycie tras mierzymy głównie przez adsbdb.
- Próg bramki (typ ≥ 90%, zgodność ≥ 95%) to założenie planu, a nie wymóg z PRD.

## Success Criteria (Summary)

- Pomiar pokazuje, że źródło daje typ w formacie zgodnym z ustawieniami. W przeciwnym razie wiemy o tym przed S-03.
- Z produkcji oba źródła odpowiadają przez `/api/adsb/probe`, a decyzja jest zapisana w `context/foundation/adsb-source.md`.
