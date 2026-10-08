# Trasa w alercie (S-07) — plan implementacji

## Overview

S-07 z roadmapy (`route-in-alerts`), FR-009 i US-01. W alercie o samolocie cywilnym użytkownik widzi lotnisko wylotu
i celu, gdy są znane. Brak trasy nigdy nie blokuje powiadomienia i opóźnia je najwyżej o ograniczony timeout
zapytania (2 s). Źródłem tras jest adsbdb (`GET /v0/callsign/{callsign}`), wybrane w F-01.

## Current State Analysis

- Treść alertu buduje `formatAlertMessage(aircraft, prediction, now)` (`src/lib/alerts.ts:40`). Linia trasy jest
  stała: `"Route unknown"` (`src/lib/alerts.ts:54`). Test sprawdza ją w `src/lib/alerts.test.ts:71`.
- Poller (`src/workers/alert-poller.ts:131-176`) dla każdego kandydata po deduplikacji wysyła wiadomość
  (`sendTelegramMessage`), a dopiero potem zapisuje wiersz do `alert_notifications`. Każde zapytanie o trasę wpięte
  przed wysyłkę dotyczy więc tylko alertów, które naprawdę wyjdą.
- `AircraftState` ma już `callsign` (`flight` po `trim`, pusty → `null`) i `military` (`dbFlags & 1`)
  (`src/lib/adsb.ts:31-45`). W pomiarze F-01 `flight` był wypełniony u 99,3% samolotów w powietrzu.
- adsbdb według `context/foundation/adsb-source.md` („Trasy”): bez klucza, limit nieopublikowany, 37/60 znaków
  wywoławczych z trasą (61,7%), średnio 42 ms. Dostępność z Cloudflare Workers nie była testowana. Poller dziś
  działa lokalnie (`npm run cron:local`), więc nie blokuje to tej zmiany.
- Kształt odpowiedzi adsbdb sprawdzony 2026-10-08:
  - trafienie: HTTP 200, `{"response":{"flightroute":{"callsign":…,"origin":{…},"destination":{…}}}}`, gdzie
    lotnisko ma m.in. `iata_code`, `icao_code`, `municipality`, `name`;
  - pudło: HTTP 404, `{"response":"unknown callsign"}`.
- Wzorzec klienta zewnętrznego API: `src/lib/adsb.ts` i `src/lib/telegram.ts`. Każdy używa globalnego `fetch`,
  `AbortSignal.timeout`, nie rzuca wyjątków i zwraca wynik dyskryminowany. Moduły w `src/lib` bez importów `astro:*`
  są testowane w Vitest.
- Podsumowanie biegu (`AlertPollSummary`, `src/workers/alert-poller.ts:16-23`) trafia do logu
  przez `describeSummary` (`src/workers/scheduled.ts:15-21`). Każdy wpis w `summary.errors` zmienia status biegu
  w `cron_runs` na `error` (`src/workers/scheduled.ts:55-58`).

## Desired End State

Alert o samolocie cywilnym ze znanym znakiem wywoławczym, który adsbdb zna, ma linię
`Route: Warsaw (WAW) → Chicago (ORD)` zamiast `Route unknown`, a ostatnia linia brzmi `Data: adsb.fi, adsbdb`.
Samoloty wojskowe, samoloty bez znaku wywoławczego, pudła adsbdb, błędy sieci i odpowiedzi po 2 s dają
`Route unknown` i `Data: adsb.fi`, a alert idzie jak dotąd. Log biegu crona pokazuje dodatkowo `routes: N`.

### Key Discoveries:

- Linia `"Route unknown"` jest jedynym miejscem do zmiany w treści (`src/lib/alerts.ts:54`).
- Wysyłka jest sekwencyjna i stoi w pętli kandydatów (`src/workers/alert-poller.ts:135-142`). Zapytanie o trasę
  wchodzi bezpośrednio przed `sendTelegramMessage`, po `isRecentlyAlerted`.
- Ten sam samolot może być kandydatem u kilku użytkowników w jednym biegu, a więc pamięć podręczna po znaku
  wywoławczym musi żyć na poziomie całego `runAlertPoll`, nie pętli jednego użytkownika.
- Błędy trasy nie mogą trafiać do `summary.errors`, bo zamieniłyby każdy bieg z pudłem adsbdb w `error`.

## What We're NOT Doing

- Bez sprawdzania wiarygodności trasy względem pozycji samolotu. Trasa z adsbdb trafia do alertu bez weryfikacji
  geometrycznej (decyzja użytkownika). Możliwa trasa z innego rejsu pod tym samym znakiem jest znanym ryzykiem.
- Bez zapytań o trasę dla samolotów z flagą `military`.
- Bez zapisu trasy w `public.alert_notifications` i bez migracji.
- Bez edycji wysłanej wiadomości (`editMessageText`). Trasa jest znana przed wysyłką albo wcale.
- Bez cache'u tras między biegami (np. w bazie lub KV). Cache żyje tylko w jednym biegu.
- Bez testu dostępności adsbdb z produkcyjnego Workera. Wdrożenie produkcyjne pollera jest odłożone (`## Parked`).
- Bez adsb.lol `routeset` (zwraca 201 z pustym ciałem, `adsb-source.md`).

## Implementation Approach

Nowy czysty moduł `src/lib/routes.ts` jako jedyne miejsce, które zna adsbdb: endpoint, kształt odpowiedzi
i format wyświetlania trasy. `formatAlertMessage` dostaje trasę jako parametr (`Route | null`). Poller pyta o trasę
tuż przed wysyłką i zapamiętuje wynik po znaku wywoławczym na czas biegu. Każda porażka zapytania to `null`.

## Faza 1: Klient adsbdb i format trasy

### Overview

Czysty moduł z zapytaniem o trasę i formatowaniem, w pełni pokryty testami Vitest (z zastąpionym `fetch`).

### Changes Required:

#### 1. Klient adsbdb

**File**: `src/lib/routes.ts` (nowy)

**Intent**: Pobranie trasy po znaku wywoławczym z adsbdb i sprowadzenie odpowiedzi do minimalnego modelu, którego
potrzebuje alert. Jak `adsb.ts` i `telegram.ts`: globalny `fetch`, ten sam `User-Agent`
(`nad-glowa (+https://nad-glowa.mateusz-kosciolko-321.workers.dev)`), timeout, nigdy nie rzuca. Bez importów
`astro:*` i Supabase, żeby dało się go testować w Vitest.

**Contract**:

- `export interface RouteAirport { code: string; city: string | null }`. `code` to `iata_code`, a gdy go brak,
  `icao_code` (po `trim`; pusty ciąg = brak). `city` to `municipality` po `trim`, pusty → `null`.
- `export interface Route { origin: RouteAirport; destination: RouteAirport }`.
- `export const ROUTE_LOOKUP_TIMEOUT_MS = 2000`.
- `export function parseRouteResponse(body: unknown): Route | null`: czysta funkcja. Zwraca `null`, gdy brak
  `response.flightroute`, gdy `response` jest ciągiem (pudło) albo gdy którekolwiek lotnisko nie ma ani kodu IATA,
  ani ICAO.
- `export async function lookupRoute(callsign: string): Promise<Route | null>`:
  `GET https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}` z `AbortSignal.timeout(ROUTE_LOOKUP_TIMEOUT_MS)`.
  HTTP inny niż 200, błąd sieci, timeout (także w trakcie czytania ciała) i niepoprawny JSON → `null`. Tylko
  „jest trasa albo jej nie ma”. Przyczyny porażki nie są potrzebne nikomu poza logiem, a ten celowo jej nie dostaje.
- `export function formatRoute(route: Route): string` → `"Warsaw (WAW) → Chicago (ORD)"`. Lotnisko bez miasta to sam
  kod (`"EPWA → Chicago (ORD)"`). Strzałka to znak U+2192 (wiadomość idzie jako czysty tekst, bez escapowania).

#### 2. Testy

**File**: `src/lib/routes.test.ts` (nowy)

**Intent**: Pokrycie parsera, fallbacków formatu i ścieżek porażki klienta bez sieci (`vi.stubGlobal("fetch", …)`).
`describe`/`it`/`expect`/`vi` importowane jawnie z `vitest`.

**Contract**: przypadki co najmniej:

- `parseRouteResponse` na odpowiedzi trafienia (struktura jak w Current State Analysis) → kody `WAW`/`ORD`,
  miasta `Warsaw`/`Chicago`;
- pudło `{"response":"unknown callsign"}` → `null`;
- lotnisko bez `iata_code`, z `icao_code` → kod ICAO;
- lotnisko bez obu kodów → całość `null`;
- `formatRoute` z miastami i bez miasta po jednej stronie;
- `lookupRoute`: 200 z trasą → `Route`; 404 → `null`; `fetch` odrzuca (błąd sieci) → `null`; `fetch` odrzuca
  `TimeoutError` → `null`; 200 z ciałem nie-JSON → `null`; URL zawiera zakodowany znak wywoławczy.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Lint przechodzi: `npm run lint`
- Sprawdzenie typów przechodzi: `npx astro sync && npx astro check`

**Implementation Note**: Po przejściu weryfikacji automatycznej przejdź do Fazy 2. Ta faza nie ma kroków ręcznych.

---

## Faza 2: Trasa w alercie

### Overview

`formatAlertMessage` pokazuje trasę, a poller pyta o nią przed wysyłką, z pominięciem wojskowych i z cache'em na bieg.

### Changes Required:

#### 1. Treść alertu

**File**: `src/lib/alerts.ts`

**Intent**: Zamiana stałej linii `Route unknown` na trasę, gdy jest znana. Gdy trasa pochodzi z adsbdb, źródło
dopisuje się do linii atrybucji.

**Contract**: `formatAlertMessage(aircraft, prediction, route: Route | null, now)`. Przy `route` linia trasy to
`` `Route: ${formatRoute(route)}` ``, a ostatnia linia to `Data: adsb.fi, adsbdb`. Przy `null` linie zostają
bez zmian (`Route unknown`, `Data: adsb.fi`). Kolejność pozostałych linii bez zmian. Komentarz modułu (czysta
logika, bez importów serwerowych) nadal prawdziwy: `routes.ts` też jest czysty.

#### 2. Testy treści

**File**: `src/lib/alerts.test.ts`

**Intent**: Dostosowanie istniejących wywołań do nowej sygnatury i pokrycie obu wariantów linii trasy.

**Contract**: dotychczasowe testy przekazują `route: null` i dalej oczekują `Route unknown` oraz `Data: adsb.fi`
bez `adsbdb`. Nowy test: trasa WAW→ORD daje `Route: Warsaw (WAW) → Chicago (ORD)` i `Data: adsb.fi, adsbdb`,
a nie zawiera `Route unknown`.

#### 3. Poller

**File**: `src/workers/alert-poller.ts`

**Intent**: Zapytanie o trasę tylko dla alertu, który za chwilę zostanie wysłany. Wynik zapamiętany po znaku
wywoławczym na cały bieg, żeby ten sam samolot u kilku użytkowników nie generował kilku zapytań do adsbdb
o nieopublikowanym limicie.

**Contract**:

- W `runAlertPoll` jedna `Map<string, Promise<Route | null>>` na bieg (cache obietnic, więc zapytanie o ten sam
  znak nie leci dwa razy nawet przy przyszłej równoległości).
- Po `isRecentlyAlerted`, przed `sendTelegramMessage`: gdy `aircraft.military === false` i
  `aircraft.callsign !== null`, trasa = wynik z cache albo `lookupRoute(callsign)`. W przeciwnym razie `null` bez zapytania.
- `formatAlertMessage(aircraft, prediction, route, at)`.
- `AlertPollSummary` dostaje `routes: number`: liczbę **wysłanych** alertów z trasą (zwiększane po udanej wysyłce
  przy `route !== null`). Porażki zapytania o trasę nie trafiają do `summary.errors`.
- Kolejność „wyślij, potem zapisz” i obsługa błędów Telegrama bez zmian.

#### 4. Log biegu

**File**: `src/workers/scheduled.ts`

**Intent**: Widoczność pokrycia tras w logu crona bez migracji.

**Contract**: `describeSummary` dopisuje `routes: N` za `sent: N`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Lint przechodzi: `npm run lint`
- Sprawdzenie typów przechodzi: `npx astro sync && npx astro check`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Przy `npm run dev` + `npm run cron:local` i typie samolotu cywilnego, który często przelatuje w promieniu (np.
  popularny typ pasażerski w ustawieniach testowych), przychodzi alert z linią `Route: … → …` i `Data: adsb.fi, adsbdb`
- Log biegu crona pokazuje `routes: N` i bieg z alertem bez trasy kończy się statusem `ok`
- Alert bez znanej trasy (lub z wojskowym typem, jeśli się trafi) ma `Route unknown` i `Data: adsb.fi`

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przez
człowieka, że test ręczny się udał.

---

## Testing Strategy

### Unit Tests:

- `src/lib/routes.test.ts`: parser (trafienie, pudło, fallback IATA → ICAO, brak kodów), format (z miastem i bez),
  klient (200, 404, błąd sieci, timeout, nie-JSON, kodowanie znaku wywoławczego).
- `src/lib/alerts.test.ts`: oba warianty linii trasy i atrybucji.

### Integration Tests:

- Brak nowych. Poller nie ma testów jednostkowych (importuje `astro:env/server`), a smoke nie wywołuje crona.
  Zachowanie pollera sprawdza test ręczny.

### Manual Testing Steps:

1. `npm run dev`, potem `npm run cron:local` z `TELEGRAM_BOT_TOKEN` i `SUPABASE_SERVICE_KEY` w `.dev.vars`.
2. W ustawieniach wybrać typ cywilny często widoczny nad domem, odczekać na alert i sprawdzić linię trasy.
3. Sprawdzić w logu terminala `routes:` i status biegu.
4. Opcjonalnie: przy wyłączonej sieci do adsbdb (np. błędny host w kodzie lokalnie, niecommitowany) alert przychodzi
   z `Route unknown` najwyżej ~2 s później.

## Performance Considerations

Jedno zapytanie (≤ 2 s, średnio ~42 ms) na unikalny znak wywoławczy wysyłanego alertu w biegu. Liczba alertów na
bieg jest mała (deduplikacja 60 min), więc koszt czasu biegu i obciążenie adsbdb są pomijalne. Najgorszy przypadek
przy niedostępnym adsbdb: +2 s na każdy wysyłany alert z innym znakiem wywoławczym w danym biegu.

## Migration Notes

Brak. Schemat bez zmian, stare wiersze `alert_notifications` nie są dotykane.

## References

- Roadmapa: `context/foundation/roadmap.md` (S-07)
- Źródło tras: `context/foundation/adsb-source.md` („Trasy (odpowiedź dla S-07)”)
- PRD: `context/foundation/prd.md` (FR-009, US-01)
- Wzorzec klienta: `src/lib/adsb.ts`, `src/lib/telegram.ts`
- Poller: `src/workers/alert-poller.ts:131-176`
- Treść alertu: `src/lib/alerts.ts:40-59`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Klient adsbdb i format trasy

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `npm test` — ef9b9c5
- [x] 1.2 Lint przechodzi: `npm run lint` — ef9b9c5
- [x] 1.3 Sprawdzenie typów przechodzi: `npx astro sync && npx astro check` — ef9b9c5

### Phase 2: Trasa w alercie

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm test` — d83aa46
- [x] 2.2 Lint przechodzi: `npm run lint` — d83aa46
- [x] 2.3 Sprawdzenie typów przechodzi: `npx astro sync && npx astro check` — d83aa46
- [x] 2.4 Build przechodzi: `npm run build` — d83aa46

#### Manual

- [x] 2.5 Alert z linią `Route: … → …` i `Data: adsb.fi, adsbdb` przy `npm run cron:local` — d83aa46
- [x] 2.6 Log biegu pokazuje `routes: N`, bieg z alertem bez trasy kończy się statusem `ok` — d83aa46
- [x] 2.7 Alert bez znanej trasy ma `Route unknown` i `Data: adsb.fi` — d83aa46
