# Trasa w alercie (S-07) — Plan Brief

> Full plan: `context/changes/route-in-alerts/plan.md`

## What & Why

W alercie o samolocie cywilnym użytkownik ma widzieć lotnisko wylotu i celu, gdy są znane (FR-009, US-01, S-07).
Dziś każdy alert ma stałą linię `Route unknown`. Brak trasy nadal nie może blokować powiadomienia.

## Starting Point

Poller (`src/workers/alert-poller.ts`) wysyła alert przez Telegram z treścią z `formatAlertMessage`
(`src/lib/alerts.ts`), gdzie trasa jest na sztywno „unknown”. F-01 ustaliło źródło tras: adsbdb
`GET /v0/callsign/{callsign}` (61,7% trafień, ~42 ms), bez klucza.

## Desired End State

Alert o samolocie cywilnym, którego znak wywoławczy zna adsbdb, ma linię `Route: Warsaw (WAW) → Chicago (ORD)`
i atrybucję `Data: adsb.fi, adsbdb`. Wojskowe, bez znaku wywoławczego, pudła, błędy i odpowiedzi po 2 s dają
`Route unknown`, a alert idzie jak dotąd. Log crona pokazuje `routes: N`.

## Key Decisions Made

| Decision           | Choice                                            | Why (1 sentence)                                                    | Source   |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| Źródło tras        | adsbdb po znaku wywoławczym                       | adsb.fi/adsb.lol nie dają tras, `routeset` zwraca puste ciało.      | Research |
| Format             | Miasto + IATA (`Warsaw (WAW)`); fallback kod ICAO | Czytelne na telefonie, kod rozwiewa niejednoznaczność miast.        | Plan     |
| Czekanie na adsbdb | Zapytanie przed wysyłką, timeout 2 s              | Jedna wiadomość, prosty kod; 2 s to pomijalny ułamek okna 2–15 min. | Plan     |
| Samoloty wojskowe  | Bez zapytania, `Route unknown`                    | S-07 dotyczy cywilnych; trasy dla znaków wojskowych bywają mylące.  | Plan     |
| Wiarygodność trasy | Pokazywana zawsze, bez sprawdzania geometrii      | Decyzja użytkownika: maksymalne pokrycie, prostota.                 | Plan     |
| Dziennik alertów   | Trasa nie jest zapisywana, bez migracji           | FR-011 odłożone; nikt dziś nie czyta tych danych.                   | Plan     |
| Pamięć podręczna   | Po znaku wywoławczym, tylko w obrębie biegu       | Ten sam samolot u kilku użytkowników = jedno zapytanie do adsbdb.   | Plan     |
| Porażki zapytania  | `null`, bez wpisu w `summary.errors`              | Pudło adsbdb nie może zmieniać statusu biegu crona na `error`.      | Plan     |

## Scope

**In scope:**

- Nowy czysty moduł `src/lib/routes.ts` (klient adsbdb, parser, format) z testami Vitest
- Parametr `route` w `formatAlertMessage` i zmiana atrybucji
- Zapytanie o trasę w pollerze z cache'em na bieg i licznikiem `routes`

**Out of scope:**

- Sprawdzanie trasy względem pozycji samolotu, edycja wysłanej wiadomości
- Zapis trasy w `alert_notifications`, migracje, cache między biegami
- Test adsbdb z produkcyjnego Workera (wdrożenie pollera odłożone)

## Architecture / Approach

`routes.ts` jest jedynym miejscem znającym adsbdb (jak `adsb.ts` dla ADS-B i `telegram.ts` dla Telegrama): `fetch`
z `AbortSignal.timeout(2000)`, nigdy nie rzuca, zwraca `Route | null`. Poller po deduplikacji, a przed
`sendTelegramMessage`, bierze trasę z mapy obietnic na bieg albo pyta adsbdb (tylko cywilne ze znakiem
wywoławczym) i przekazuje ją do `formatAlertMessage`.

## Phases at a Glance

| Phase                           | What it delivers                                      | Key risk                                             |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| 1. Klient adsbdb i format trasy | `routes.ts` + testy parsera, formatu i porażek        | Kształt odpowiedzi adsbdb zmieni się bez uprzedzenia |
| 2. Trasa w alercie              | Linia trasy w alercie, zapytanie w pollerze, `routes` | Trasa z rozkładu nie pasuje do bieżącego rejsu       |

**Prerequisites:** S-03 (`first-advance-alert`) zarchiwizowane; lokalny `npm run dev` + `npm run cron:local`
z `TELEGRAM_BOT_TOKEN` do testu ręcznego.
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- adsbdb zna trasy po znaku wywoławczym (rozkład), więc część pokazanych tras może dotyczyć innego rejsu; świadomie
  akceptowane bez weryfikacji geometrii.
- Limit adsbdb jest nieopublikowany; zakładamy, że kilka zapytań na bieg go nie wyczerpie.
- Dostępność adsbdb z Cloudflare Workers nieprzetestowana; nieistotne, dopóki poller działa lokalnie.

## Success Criteria (Summary)

- Alert o znanym rejsie cywilnym pokazuje `Route: <miasto> (<kod>) → <miasto> (<kod>)`.
- Żaden alert nie zostaje wstrzymany przez brak lub błąd trasy; bieg z pudłem adsbdb kończy się `ok`.
- Testy, lint, `astro check` i build przechodzą.
