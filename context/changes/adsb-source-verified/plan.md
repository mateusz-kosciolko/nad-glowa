# Zweryfikowane źródło danych ADS-B (F-01) — plan implementacji

## Overview

Wybieramy darmowe publiczne źródło ADS-B, z którego skorzysta alert S-03, i potwierdzamy je empirycznie. Dla okolicy domu źródło ma zwracać typ samolotu, identyfikator maszyny, pozycję, kurs i prędkość. Ma być osiągalne z produkcyjnego Workera na IP Cloudflare. Decyzja, limity i warunki użycia trafiają do dokumentu. Źródłem podstawowym jest **adsb.fi**, zapasowym **adsb.lol** (ten sam format odpowiedzi). Zmiana dostarcza typowanego klienta `src/lib/adsb.ts`, z którego S-03 skorzysta bez przepisywania, oraz chronioną sondę diagnostyczną `GET /api/adsb/probe`. To element roadmapy **F-01 `adsb-source-verified`**. Rozstrzyga Open Roadmap Question 2 i odblokowuje S-03 i S-06.

## Current State Analysis

- **Kod:** nie ma żadnego kodu pobierającego dane lotów. Poza auth jedynym endpointem jest `POST /api/settings` (`src/pages/api/settings.ts`). Ustawienia (`alert_settings`: `home_lat`/`home_lon numeric(5,2)`, `radius_km` 1–100, `aircraft_types`) czyta się pod RLS przez `createClient()` i `.maybeSingle()` (`src/pages/settings.astro:20-24`).
- **Kody typów:** ustawienia przyjmują kody pasujące do `ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/` (`src/lib/alert-settings.ts:7`). Roadmapa (S-02, Risk) zaznacza, że jeśli źródło raportuje typy inaczej, S-03 będzie potrzebował mapowania. To trzeba zmierzyć.
- **Produkcja:** Worker `nad-glowa` na planie **Free**, bez crona (cron i Workers Paid to F-02). Zwykłe żądanie HTTP na Free ma 10 ms CPU, a czas oczekiwania na `fetch` się do tego nie liczy. `preview_urls: false`, więc weryfikacja z IP Cloudflare jest możliwa wyłącznie na produkcji (`context/deployment/deploy-plan.md`).
- **Research źródeł (2026-09-28, zapytania z sandboxa, nie z IP Cloudflare):**
  - adsb.fi: `GET https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` (promień w **milach morskich**, maks. 250). Odpowiedź `{ac:[…], now, total, …}`. Pola `hex`, `t`, `r`, `flight`, `lat`, `lon`, `track`, `gs`, `alt_baro` (`"ground"` na ziemi), `dbFlags`, `seen_pos` oraz dodatkowo `desc`. Na żywo HTTP 200, 31 samolotów w promieniu 50 nm od 52.23/21.01. Limit: 1 zapytanie na sekundę. Nadmiar odpowiedzi 4xx grozi czasową blokadą IP. Warunki: tylko użytek niekomercyjny, trzeba podać adsb.fi jako źródło i dać link do jego strony.
  - adsb.lol: `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}` (maks. 250 nm), ten sam schemat pól. `dbFlags & 1` oznacza samolot wojskowy (potwierdzone na `/v2/mil`). Licencja ODbL 1.0. Limit „dynamiczny”, bez podanej liczby. Zapowiedziany obowiązkowy klucz API. Ma `POST /api/0/routeset`, ale kształt jego odpowiedzi nie jest potwierdzony: test zwrócił 201 z pustym ciałem.
  - Odrzucone: **OpenSky** (brak typu w wektorze stanu, 400 kredytów dziennie bez konta, doniesienia o blokowaniu IP chmurowych), **airplanes.live** (403, dostęp tylko po zgodzie mailowej), **ADS-B Exchange** (brak darmowego API od 2025-03).
  - Trasy: `GET https://api.adsbdb.com/v0/callsign/{callsign}` zwróciło trasę EPWA→KORD dla `LOT3`. Nie wymaga klucza. Limit nie jest opublikowany.
- **Testy:** nie ma runnera testów jednostkowych, jedynym testem automatycznym jest `scripts/smoke.mjs`. Skrypty `scripts/*.mjs` nie mają zależności i mają własny blok ESLint z listą globali (`eslint.config.js:74-79`).

## Desired End State

- `context/foundation/adsb-source.md` zapisuje decyzję: adsb.fi jako źródło podstawowe, adsb.lol jako zapasowe. Zawiera endpointy, mapowanie pól, limity i warunki, wyniki pomiaru, wynik z produkcji, odrzucone źródła z powodami, odpowiedź na pytanie o trasy (S-07) i wskazówki dla S-03.
- `npm run adsb:measure` mierzy jakość danych obu źródeł i pokrycie tras w adsbdb, a wynik zapisany jest w `context/changes/adsb-source-verified/measurement.md`.
- `src/lib/adsb.ts` pobiera samoloty w promieniu od punktu i normalizuje je do `AircraftState`. Nigdy nie rzuca wyjątkiem, każdy błąd zwraca jako `ok: false`.
- Na produkcji zalogowany użytkownik z ustawionym domem otwiera `/api/adsb/probe` i `/api/adsb/probe?source=adsb.lol` i dostaje JSON z `ok: true` i `total > 0`. Anonim dostaje 302 na `/auth/signin`.
- Każda strona ma w stopce atrybucję „Aircraft data: adsb.fi” z linkiem.
- Roadmapa oznacza Open Roadmap Question 2 jako rozstrzygnięte i ma odpowiedź na niewiadomą S-07.

### Key Discoveries:

- Wzorzec chronionej trasy: `src/middleware.ts:4` (`PROTECTED_ROUTES`, dopasowanie prefiksem).
- Wzorzec odczytu ustawień pod RLS: `src/pages/settings.astro:15-24`.
- Wzorzec endpointu (`locals.user`, `createClient` z obsługą `null`): `src/pages/api/settings.ts:5-14`.
- Wzorzec skryptu bez zależności z listą kroków i kodem wyjścia: `scripts/smoke.mjs:40-110`.
- Globale dla skryptów deklaruje `eslint.config.js:77`. Nowy skrypt będzie potrzebował co najmniej `setTimeout`, `AbortSignal` i `performance`.
- Na `Layout.astro` opiera się każda strona, a dziś nie ma on stopki (`src/layouts/Layout.astro:20-35`).

## What We're NOT Doing

- **Cron, handler `scheduled`, Workers Paid i heartbeat.** To F-02.
- **Predykcja najbliższego podejścia, dopasowanie do ustawień i wysyłka powiadomień.** To S-03. Klient zwraca surowy stan samolotów i nie filtruje po typie ani trasie lotu.
- **Deduplikacja po maszynie.** To S-04.
- **Słownik typów z czytelnymi nazwami.** To S-06. Pole `desc` z adsb.fi odnotujemy w dokumencie decyzji jako możliwe źródło nazw.
- **Trasa w alercie.** To S-07. Tu mierzymy tylko pokrycie tras, żeby odpowiedzieć na niewiadomą.
- **Automatyczne przełączanie źródeł w kodzie.** Zapas działa przez parametr `source` klienta, a zmiana domyślnego źródła to zmiana stałej.
- **Sprawdzenie płatnej konkurencji (PRD Q1).** Zgodnie z decyzją pytanie zostaje otwarte w roadmapie.
- Flaga „wojskowe” w UI (FR-007), klucze API, własny feeder, cache lub KV, runner testów jednostkowych.

## Implementation Approach

Kolejność: pomiar, klient, produkcja. Faza 1 mierzy surowe dane skryptem, zanim powstanie jakikolwiek kod aplikacji. Jeśli typów brakuje, kończymy na bramce ręcznej, a PRD wymaga rewizji. Faza 2 buduje typowany klient i cienką sondę, która tego klienta wywołuje. Dzięki temu produkcyjny test w fazie 3 sprawdza prawdziwy kod S-03, a nie osobny skrypt. Faza 3 wypycha kod, potwierdza dostępność obu źródeł z IP Cloudflare i utrwala decyzję.

## Critical Implementation Details

**Mile morskie:** oba API przyjmują promień w nm, a ustawienia mają km. Pomyłka o czynnik 1,852 po cichu zmniejszyłaby obszar. Konwersja zaokrągla w górę (`Math.ceil(km / 1.852)`) i ogranicza wynik do 250.

**Limit adsb.fi i odpowiedzi 4xx:** błędne zapytania (4xx) liczą się do limitu i mogą czasowo zablokować IP. Na produkcji to współdzielone IP Cloudflare. Skrypt pomiarowy wysyła najwyżej jedno zapytanie na źródło na próbkę, a zapytania do adsbdb idą sekwencyjnie co 1 s. Klient i skrypt wysyłają nagłówek `User-Agent` z nazwą aplikacji i jej produkcyjnym URL-em.

**Prywatność sondy:** zapytanie do źródła nieuchronnie zawiera przybliżoną lokalizację domu (~1 km), bo tak samo będzie działać S-03. Odpowiedź sondy nie może jednak zwracać współrzędnych domu ani pozycji i odległości samolotów. Zwraca wyłącznie liczniki i identyfikatory maszyn. Wyniki pomiaru zapisujemy tylko dla domyślnego punktu (centrum Warszawy 52.23/21.01), nigdy dla prawdziwej lokalizacji.

**Wynik w fazie 3 zależny od produkcji:** jeśli adsb.fi odrzuca IP Cloudflare, a adsb.lol działa, zamieniamy `DEFAULT_ADSB_SOURCE` na `adsb.lol`, wdrażamy ponownie i odnotowujemy to w decyzji. Stopka z atrybucją podąża za stałą automatycznie (licencja ODbL adsb.lol też wymaga informacji o źródle). Jeśli oba odrzucają, zatrzymujemy fazę i wracamy do użytkownika. `infrastructure.md` wskazuje Railway jako zapasową platformę.

---

## Faza 1: Pomiar empiryczny źródeł

### Overview

Skrypt bez zależności przez około 30 minut pobiera próbki z adsb.fi i adsb.lol dla punktu i promienia. Liczy pokrycie pól, zgodność kodów typów z `ICAO_TYPE_PATTERN`, świeżość pozycji i liczbę samolotów wojskowych. Sprawdza też pokrycie tras w adsbdb. Wynik jest bramką „czy jedziemy dalej”.

### Changes Required:

#### 1. Skrypt pomiarowy

**File**: `scripts/adsb-measure.mjs`

**Intent**: zmierzyć, czy darmowe źródła rzeczywiście dają to, czego potrzebuje reguła biznesowa, zanim na nich zbudujemy. Skrypt działa bez zależności i uruchamia się tak samo jak smoke.

**Contract**:

- Zmienne środowiskowe z wartościami domyślnymi: `LAT=52.23`, `LON=21.01`, `RADIUS_KM=100`, `SAMPLES=6`, `INTERVAL_S=300`, `ROUTE_LOOKUPS=10`. Promień jest przeliczany na nm tak, jak opisano w Critical Implementation Details.
- Każda próbka wysyła po jednym `GET` do adsb.fi (v3) i adsb.lol (v2 point) i zapisuje status HTTP, czas odpowiedzi i liczbę samolotów w `ac`. Dla samolotów w powietrzu (z pozycją, bez `alt_baro === "ground"`) liczy: odsetek z niepustym `t`, odsetek `t` pasujących do `/^[A-Z0-9]{2,4}$/` po `trim` i `toUpperCase`, odsetek z `hex`, `r`, `flight`, `track` i `gs`, liczbę samolotów wojskowych (`dbFlags & 1`), liczbę wpisów z `hex` zaczynającym się od `~` (adres spoza ICAO) oraz medianę i maksimum `seen_pos`.
- Wypisuje listę różnych wartości `t`, które nie pasują do wzorca. Tu wyjdzie ewentualna potrzeba mapowania.
- Trasy: z każdej próbki adsb.fi bierze do `ROUTE_LOOKUPS` różnych niepustych znaków wywoławczych i pyta `https://api.adsbdb.com/v0/callsign/{callsign}`, sekwencyjnie co 1 s. Liczy trafienia (200 z trasą) i braki. Raz na uruchomienie wysyła best-effort `POST https://api.adsb.lol/api/0/routeset` z body `{"planes":[{"callsign","lat","lng"}…]}` i wypisuje status oraz pierwsze 300 znaków odpowiedzi. Ten krok nigdy nie przerywa skryptu.
- Na końcu wypisuje zbiorczą tabelę Markdown (wiersz na źródło plus wiersz tras). Nie wypisuje `LAT`/`LON`, jeśli różnią się od domyślnych.
- Kod wyjścia: `1`, jeśli któreś źródło nie zwróciło ani jednej poprawnej próbki. W przeciwnym razie `0`.

#### 2. Skrypt npm i globale ESLint

**File**: `package.json`, `eslint.config.js`

**Intent**: uruchamiać pomiar jednym poleceniem i utrzymać czysty lint.

**Contract**: w `package.json` skrypt `"adsb:measure": "node scripts/adsb-measure.mjs"`. W `scriptsConfig` (`eslint.config.js:77`) lista globali poszerzona o te, których użyje skrypt (np. `setTimeout`, `AbortSignal`, `performance`).

#### 3. Zapis wyników

**File**: `context/changes/adsb-source-verified/measurement.md`

**Intent**: utrwalić surowy wynik pomiaru do bramki ręcznej i do dokumentu decyzji w fazie 3.

**Contract**: data i godzina, parametry uruchomienia (domyślny punkt, promień, liczba próbek), wklejona tabela zbiorcza, lista kodów niepasujących do wzorca, wynik `routeset` i werdykt względem progu z Manual Verification.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi z nowym skryptem: `npm run lint`
- Krótki przebieg pomiaru kończy się kodem 0 i wypisuje tabelę dla obu źródeł: `SAMPLES=1 ROUTE_LOOKUPS=3 npm run adsb:measure`

#### Manual Verification:

- Pełny pomiar (`npm run adsb:measure`, ~30 min, w tle lub przez człowieka) jest zapisany w `measurement.md`, a próg jest spełniony: `t` obecne u ≥ 90% samolotów w powietrzu, a ≥ 95% obecnych `t` pasuje do wzorca. Odsetki liczone łącznie ze wszystkich próbek, osobno dla każdego źródła. Bramka dotyczy źródła podstawowego (adsb.fi): jeśli nie spełnia progu, zatrzymujemy zmianę do rewizji PRD. Jeśli progu nie spełnia tylko adsb.lol, zmiana idzie dalej, a fakt trafia do „Otwartych ryzyk” w `adsb-source.md`.

**Implementation Note**: po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu bramki przez człowieka, zanim zaczniesz fazę 2.

---

## Faza 2: Klient ADS-B i sonda diagnostyczna

### Overview

Typowany klient źródła, chroniony endpoint sondy, który z niego korzysta, krok smoke dla anonima i atrybucja adsb.fi w stopce.

### Changes Required:

#### 1. Klient ADS-B

**File**: `src/lib/adsb.ts`

**Intent**: jedno miejsce, które zna endpointy, jednostki i format źródeł i oddaje resztę aplikacji znormalizowany stan samolotów. S-03 użyje go bez zmian kontraktu.

**Contract** (inne fazy i S-03 zależą od tych sygnatur):

```ts
export type AdsbSourceId = "adsb.fi" | "adsb.lol";
export const DEFAULT_ADSB_SOURCE: AdsbSourceId; // "adsb.fi"
export const ADSB_SOURCES: Record<
  AdsbSourceId,
  { label: string; homepage: string; pointUrl(lat: number, lon: number, radiusNm: number): string }
>;

export interface AircraftState {
  hex: string; // lowercase, as reported; ICAO 24-bit, or `~`-prefixed non-ICAO address (TIS-B) — not stable for S-04 dedup
  type: string | null; // `t`, trimmed + uppercased
  registration: string | null; // `r`
  callsign: string | null; // `flight`, trimmed
  lat: number;
  lon: number;
  trackDeg: number | null; // `track`
  groundSpeedKt: number | null; // `gs`
  onGround: boolean; // alt_baro === "ground"
  military: boolean; // (dbFlags & 1) === 1
  positionAgeS: number | null; // `seen_pos`
}

export type AdsbFetchResult =
  | {
      ok: true;
      source: AdsbSourceId;
      httpStatus: number;
      durationMs: number;
      aircraft: AircraftState[];
      skipped: number;
    }
  | { ok: false; source: AdsbSourceId; httpStatus: number | null; durationMs: number; error: string };

export function parseAdsbResponse(body: unknown): { aircraft: AircraftState[]; skipped: number } | null;
export function fetchAircraftNear(
  query: { lat: number; lon: number; radiusKm: number },
  source?: AdsbSourceId,
): Promise<AdsbFetchResult>;
export function summarizeAircraft(aircraft: AircraftState[]): AircraftSummary;
```

- `parseAdsbResponse` zawęża typ z `unknown` bez `any` (strict type-checked lint). Zwraca `null`, gdy brakuje tablicy `ac`. Wpisy bez `hex` albo bez liczbowych `lat`/`lon` pomija i liczy w `skipped`. Puste stringi zamienia na `null`.
- `fetchAircraftNear` nigdy nie rzuca. Błąd sieci, timeout 10 s (`AbortSignal.timeout`), odpowiedź inna niż 2xx, niepoprawny JSON i nieznany kształt zwraca jako `ok: false` z czytelnym `error`. Wysyła nagłówek `User-Agent` (patrz Critical Implementation Details). Przelicza km na nm zgodnie z opisem wyżej.
- `summarizeAircraft` zwraca `AircraftSummary`: `total`, `airborne`, `withType`, `typeMatchesPattern` (przez `ICAO_TYPE_PATTERN` z `@/lib/alert-settings`), `withRegistration`, `withCallsign`, `withTrackAndSpeed`, `military`, `maxPositionAgeS`. Bez współrzędnych.
- Moduł nie importuje nic serwerowego (`astro:env`, Supabase). To czysta logika plus globalny `fetch`.

#### 2. Endpoint sondy

**File**: `src/pages/api/adsb/probe.ts`

**Intent**: potwierdzić z dowolnego środowiska, a przede wszystkim z produkcji na IP Cloudflare, że wybrane źródło odpowiada dla okolicy domu zalogowanego użytkownika. Endpoint zostaje jako diagnostyka dla S-03.

**Contract**: `export const GET: APIRoute`. To endpoint diagnostyczny, nie formularz auth, więc odpowiada JSON-em, a konwencja redirectu `?error=` go nie dotyczy. Każda odpowiedź ma `Cache-Control: no-store`.

- Anonim: middleware przekierowuje. W handlerze obrona w głąb jak w `settings.ts:6-9`.
- `createClient` zwraca `null` → 503 `{ error }`.
- Parametr `source` spoza `ADSB_SOURCES` → 400 `{ error }`. Brak parametru oznacza `DEFAULT_ADSB_SOURCE`.
- Czyta `home_lat, home_lon, radius_km` z `alert_settings` pod RLS (`.maybeSingle()`). `error` z zapytania → 500 `{ error: error.message }`. Brak wiersza albo brak lokalizacji (`home_lat`/`home_lon` są `number | null`) → 409 `{ error: "Set your home location in /settings first" }`.
- Wywołuje `fetchAircraftNear`. Przy `ok: true` odpowiada 200 `{ source, ok, httpStatus, durationMs, radiusKm, skipped, ...summary, sample }`, gdzie `sample` to do 5 wpisów `{ hex, type, registration, callsign, military }`. Przy `ok: false` odpowiada 502 `{ source, ok, httpStatus, durationMs, error }`. Żadna odpowiedź nie zawiera współrzędnych domu ani samolotów.

#### 3. Ochrona trasy

**File**: `src/middleware.ts`

**Intent**: sonda czyta ustawienia użytkownika i odpytuje zewnętrzne API, więc wymaga logowania.

**Contract**: `PROTECTED_ROUTES` poszerzone o `"/api/adsb"`.

#### 4. Krok smoke

**File**: `scripts/smoke.mjs`

**Intent**: udowodnić, że sonda jest chroniona, bez wywoływania zewnętrznego API z CI.

**Contract**: nowy krok przed `signup`: `"adsb probe redirects anonymous user"` → `request("/api/adsb/probe")`, oczekiwane `{ status: 302, location: "/auth/signin" }`. Krok dla zalogowanego użytkownika celowo pomijamy, bo w CI zależałby od adsb.fi.

#### 5. Atrybucja źródła

**File**: `src/layouts/Layout.astro`

**Intent**: warunki adsb.fi wymagają podania źródła z linkiem do jego strony. Spełniamy to od pierwszego użycia danych.

**Contract**: stopka po `<slot />` z tekstem „Aircraft data: {label}” i linkiem do `homepage`, oba z `ADSB_SOURCES[DEFAULT_ADSB_SOURCE]` (import z `@/lib/adsb`, który nie ma importów serwerowych), więc dla adsb.fi to „Aircraft data: adsb.fi” → `https://adsb.fi`. Link ma `target="_blank" rel="noopener noreferrer"`, tekst jest mały. Korzenie stron mają `min-h-screen`, więc stopka ląduje pod pierwszym ekranem na domyślnym tle `body` (bez `bg-cosmic`). Musi mieć własne tło lub kolor tekstu, żeby była czytelna. Klasy Tailwind łączone przez `cn()`, jeśli jest ich więcej niż jeden zestaw.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro sync && npx astro check`
- Build przechodzi: `npm run build`
- Smoke przechodzi z nowym krokiem przeciwko lokalnemu serwerowi z lokalną Supabase: `npm run smoke`

#### Manual Verification:

- Lokalnie zalogowany użytkownik z ustawionym domem dostaje z `/api/adsb/probe` i z `/api/adsb/probe?source=adsb.lol` odpowiedź 200 z `ok: true` i `total > 0`. Odpowiedź nie zawiera współrzędnych.
- Stopka z linkiem do adsb.fi jest widoczna na `/` i na `/settings`.

**Implementation Note**: po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przez człowieka, zanim zaczniesz fazę 3.

---

## Faza 3: Produkcja i dokument decyzji

### Overview

Wdrożyć sondę, potwierdzić z produkcji dostępność obu źródeł na IP Cloudflare i utrwalić decyzję w dokumentach projektu.

### Changes Required:

#### 1. Wdrożenie i weryfikacja produkcji

**File**: brak (środowisko)

**Intent**: tylko produkcja wychodzi z IP Cloudflare. To jedyny sposób, żeby wykluczyć blokadę po stronie źródła, zanim zbuduje się na nim S-03.

**Contract**: `npm run build && npx wrangler deploy` (agent może to zrobić bez pytania, zgodnie z granicą z `deploy-plan.md`). Potem odczyty anonimowe `curl` i ręczne wywołanie sondy przez zalogowanego człowieka dla obu źródeł. Człowiek wkleja odpowiedzi, które nie zawierają współrzędnych. Przy odmowie działa reguła z Critical Implementation Details.

#### 2. Dokument decyzji

**File**: `context/foundation/adsb-source.md`

**Intent**: trwała decyzja fundamentu, do której odwołają się S-03, S-06 i S-07. Musi przeżyć archiwizację folderu zmiany, więc zawiera liczby, a nie tylko link.

**Contract**: frontmatter (`decided_at`, `primary: adsb.fi`, `fallback: adsb.lol`). Sekcje:

- **Decyzja** i jej uzasadnienie.
- **Endpointy i jednostki** (nm, maks. 250).
- **Mapowanie pól na `AircraftState`**.
- **Flaga wojskowa (druga połowa Open Question 2)**: `dbFlags & 1`, liczba samolotów wojskowych z pomiaru i zastrzeżenie z FR-007, że flaga obejmuje tylko samoloty widoczne w danych publicznych.
- **Limity i warunki**: adsb.fi 1 req/s, tylko użytek niekomercyjny, obowiązek atrybucji; adsb.lol ODbL, limit dynamiczny, zapowiedziany klucz.
- **Wyniki pomiaru** z `measurement.md`.
- **Dostępność z produkcji** (data, version id, statusy obu źródeł).
- **Odrzucone źródła** z powodami.
- **Trasy (odpowiedź dla S-07)**: pokrycie adsbdb i status `routeset`.
- **Wskazówki dla S-03**: jedno zapytanie na użytkownika na bieg, `seen_pos` a świeżość danych, konwersja nm, możliwość zapytania o zgrubniejszy punkt z zapasem promienia dla prywatności, `desc` dla S-06 (pole opcjonalne), `hex` z prefiksem `~` (adres spoza ICAO, liczba z pomiaru) jako niestabilny klucz deduplikacji dla S-04.
- **Otwarte ryzyka**: zapowiedziany klucz adsb.lol, brak SLA, blokada IP przy nadmiarze błędów 4xx.

#### 3. Ślad wdrożenia

**File**: `context/deployment/deploy-plan.md`

**Intent**: ścieżka audytowa tego, co jest na produkcji.

**Contract**: w „Co zostało wdrożone” akapit z datą o sondzie `/api/adsb/probe` (`PROTECTED_ROUTES` poszerzone o `/api/adsb`) i stopce z atrybucją. Aktualizacja `version_id` we frontmatterze i tabeli oraz nowa aktywna wersja w „Rollback”. Wynik weryfikacji w „Weryfikacja”.

#### 4. Adnotacje w roadmapie

**File**: `context/foundation/roadmap.md`

**Intent**: roadmapa ma pokazywać, że pytanie, które F-01 miało rozstrzygnąć, jest rozstrzygnięte. Status F-01 zmieniają skille cyklu życia, nie ta faza.

**Contract**: w `## Open Roadmap Questions` punkt 2 dostaje dopisek „Rozstrzygnięte przez F-01 → `context/foundation/adsb-source.md`”. W F-01 i S-07 niewiadoma o trasie dostaje odpowiedź z wyniku pomiaru. Frontmatter `updated:` ustawiony na datę edycji. Kolumn i pól `Status` nie zmieniamy.

### Success Criteria:

#### Automated Verification:

- Wdrożenie przechodzi: `npm run build && npx wrangler deploy`
- Produkcja: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://nad-glowa.mateusz-kosciolko-321.workers.dev/api/adsb/probe` zwraca `302 …/auth/signin`, a `/` zwraca `200`

#### Manual Verification:

- Na produkcji zalogowany użytkownik dostaje `ok: true` i `total > 0` z `/api/adsb/probe` i z `/api/adsb/probe?source=adsb.lol`
- `adsb-source.md`, `deploy-plan.md` i roadmapa są zaktualizowane, a decyzja jest zaakceptowana przez człowieka

**Implementation Note**: po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przez człowieka.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych (`CLAUDE.md`). Parser i konwersja jednostek są weryfikowane empirycznie: skrypt pomiarowy na surowych danych, sonda na prawdziwym kodzie klienta.

### Integration Tests:

- Smoke: anonim dostaje 302 z `/api/adsb/probe`.
- Sonda lokalnie (faza 2) i na produkcji (faza 3) dla obu źródeł.

### Manual Testing Steps:

1. `npm run adsb:measure` i sprawdzenie progu w `measurement.md`.
2. Lokalnie: zaloguj się, ustaw dom na `/settings`, otwórz `/api/adsb/probe` i `/api/adsb/probe?source=adsb.lol`.
3. Sprawdź, że odpowiedź nie zawiera `lat`/`lon`, a stopka linkuje do adsb.fi.
4. Powtórz punkt 2 na produkcji.
5. `/api/adsb/probe?source=foo` → 400. Konto bez ustawionego domu → 409.

## Performance Considerations

Na planie Free żądanie ma 10 ms CPU. Parsowanie od kilkudziesięciu do ~150 samolotów przy promieniu 100 km mieści się w tym z zapasem, a czas czekania na `fetch` się nie liczy. Sonda wysyła jedno zapytanie na wywołanie, więc nie zbliża się do limitu subrequestów (50 na Free).

## Migration Notes

Brak zmian w bazie. Rollback Workera (`wrangler rollback`) usuwa sondę i stopkę bez skutków ubocznych.

## References

- Roadmapa: `context/foundation/roadmap.md` (F-01, Open Roadmap Question 2, S-06, S-07)
- PRD: `context/foundation/prd.md` (Business Logic, Open Question 2, Non-Goals)
- Platforma i ryzyka: `context/foundation/infrastructure.md` (Risk Register, Railway jako runner-up)
- Poprzednia zmiana: `context/archive/2026-09-28-alert-settings-basic/plan.md`
- adsb.fi open data: https://github.com/adsbfi/opendata
- adsb.lol API: https://api.adsb.lol/docs
- adsbdb: https://www.adsbdb.com

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pomiar empiryczny źródeł

#### Automated

- [x] 1.1 Lint przechodzi z nowym skryptem: `npm run lint`
- [x] 1.2 Krótki przebieg pomiaru kończy się kodem 0 i wypisuje tabelę dla obu źródeł: `SAMPLES=1 ROUTE_LOOKUPS=3 npm run adsb:measure`

#### Manual

- [x] 1.3 Pełny pomiar zapisany w `measurement.md`, a adsb.fi spełnia próg łącznie ze wszystkich próbek (`t` ≥ 90% samolotów w powietrzu, ≥ 95% zgodnych ze wzorcem)

### Phase 2: Klient ADS-B i sonda diagnostyczna

#### Automated

- [ ] 2.1 Lint przechodzi: `npm run lint`
- [ ] 2.2 Typy przechodzą: `npx astro sync && npx astro check`
- [ ] 2.3 Build przechodzi: `npm run build`
- [ ] 2.4 Smoke przechodzi z nowym krokiem przeciwko lokalnemu serwerowi z lokalną Supabase: `npm run smoke`

#### Manual

- [ ] 2.5 Lokalnie sonda zwraca `ok: true` i `total > 0` dla adsb.fi i adsb.lol, bez współrzędnych
- [ ] 2.6 Stopka z linkiem do adsb.fi widoczna na `/` i `/settings`

### Phase 3: Produkcja i dokument decyzji

#### Automated

- [ ] 3.1 Wdrożenie przechodzi: `npm run build && npx wrangler deploy`
- [ ] 3.2 Produkcja: anonim dostaje 302 na `/auth/signin` z `/api/adsb/probe`, a `/` zwraca 200

#### Manual

- [ ] 3.3 Na produkcji sonda zwraca `ok: true` i `total > 0` dla adsb.fi i adsb.lol
- [ ] 3.4 `adsb-source.md`, `deploy-plan.md` i roadmapa zaktualizowane, decyzja zaakceptowana
