# Czytelny wybór typów samolotów (S-06) — plan implementacji

## Overview

S-06 z roadmapy (`aircraft-type-picker`), FR-002 i FR-005. Użytkownik wybiera typy samolotów z krótkiej listy
wyróżnionych „ciekawych” typów z czytelnymi nazwami, a poniżej może wyszukać w pełnej liście typów ICAO. Dziś
wpisuje kody ręcznie w jedno pole tekstowe. Model zapisu ustawień i poller się nie zmieniają.

## Current State Analysis

- Typy w formularzu to jedno pole tekstowe z kodami po przecinku
  (`src/components/settings/AlertSettingsForm.tsx`, pole `aircraft_types`). `parseAircraftTypes` dzieli je po
  `[,;\s]+`, zamienia na wielkie litery i usuwa duplikaty, a `parseAlertSettingsForm` sprawdza `ICAO_TYPE_PATTERN`
  i limit `MAX_AIRCRAFT_TYPES = 20` (`src/lib/alert-settings.ts:6-7`).
- W bazie `alert_settings.aircraft_types` to `public.icao_type[]` (domena `^[A-Z0-9]{2,4}$`) z ograniczeniem
  `types_bounded` ≤ 20 (`supabase/migrations/20260928084032_alert_settings.sql:3-4,13,23`). Poller dopasowuje pole
  `t` z adsb.fi do tych kodów, więc format zapisu jest już właściwy.
- W repo nie ma słownika typów. `context/foundation/adsb-source.md` wskazuje `desc` z adsb.fi jako kandydata, ale to
  pole przychodzi tylko z ruchem w powietrzu, więc nie daje pełnej listy.
- Pełna lista: `wiedehopf/tar1090-db`, plik `db/icao_aircraft_types2.js` (gzip, ~33 KB; po rozpakowaniu JSON
  ~110 KB). 2788 kodów, każdy jako `[name, desc, wtc]`, np. `A400 → "AIRBUS A-400M"`. Wszystkie kody pasują do
  `ICAO_TYPE_PATTERN`. 14 wpisów to pseudo-typy bez nazwy (`TWR`, `GND`, `BALL`, `DRON`, `EMER`, …). Najdłuższa
  nazwa ma 47 znaków, żadna nie zawiera apostrofu. Repozytorium nie ma licencji; dane pochodzą z publicznego
  ICAO Doc 8643.
- `context/foundation/infrastructure.md:107`: pełnej listy typów nie wolno importować w zasięgu modułu Workera
  (limit 1 s czasu startu). Mitygacja: trzymać ją w Supabase lub KV i odpytywać.
- `supabase/seed.sql` (`supabase/config.toml:60-65`) działa tylko przy lokalnym `db reset`, więc dane słownika na
  produkcję muszą wejść migracją.
- Wzorce: tabela z RLS i `revoke`/`grant` — `20260928084032_alert_settings.sql:26-43`; endpoint GET z JSON-em za
  logowaniem — `src/pages/api/adsb/probe.ts`; test pgTAP — `supabase/tests/cron_runs_rls.sql`; kroki smoke ze
  sprawdzaniem treści — `scripts/smoke.mjs` (`bodyIncludes`).
- Middleware zamyka wszystko poza `PUBLIC_ROUTES` (`src/middleware.ts:6`), więc nowy endpoint jest prywatny bez
  zmian w middleware.

## Desired End State

Na `/settings` pole tekstowe z kodami zastępuje wybierak typów z trzema częściami:

1. **Wyróżnione** — 14 przełączników z czytelną nazwą i kodem (np. „AIRBUS A-400M · A400”).
2. **Szukaj** — pole wyszukiwania w pełnym słowniku (kod lub fragment nazwy). Wynik kliknięciem dodaje typ. Gdy
   wpisany tekst jest poprawnym kodem ICAO spoza słownika, lista podpowiedzi pokazuje opcję „Add code XXXX”.
3. **Wybrane (n/20)** — chipy z nazwą i kodem, każdy z przyciskiem usunięcia. Kod spoza słownika ma dopisek
   „unknown name”.

Formularz nadal wysyła `aircraft_types` jako kody po przecinku (ukryte pole), więc `POST /api/settings`, walidacja
i poller działają bez zmian. Kody zapisane wcześniej, także spoza słownika, pojawiają się jako chipy i nie giną
przy zapisie. Weryfikacja: pgTAP dla słownika, Vitest dla rankingu, smoke dla endpointu, ręczny przegląd UI.

### Key Discoveries:

- `src/lib/alert-settings.ts:42-48` — `parseAircraftTypes` przyjmuje kody po przecinku; ukryte pole z `join(",")`
  przechodzi przez nią bez zmian w parserze.
- `src/pages/settings.astro:28-32` — strona już czyta ustawienia kluczem `anon` pod RLS; tu dochodzi drugie
  zapytanie o nazwy.
- `scripts/smoke.mjs:129-135` — `settingsForm.aircraft_types = "b744, a400 B744"`; zapis przez endpoint zostaje, więc
  ten krok dalej jest ważny.
- tar1090-db zawiera nazwy dla wszystkich 14 wyróżnionych (sprawdzone: A400, C17, C30J, C130, A124, IL76, AN12, BLCF,
  A3ST, B748, K35R, E3TF, B52, H47).

## What We're NOT Doing

- Nazwy typu w powiadomieniu Telegram — alert dalej pokazuje sam kod; poller i `src/lib/alerts.ts` bez zmian.
- Walidacja kodów względem słownika — serwer dalej sprawdza tylko wzorzec, więc literówka pasująca do wzorca
  zostanie zapisana.
- Edycja listy wyróżnionych z UI — zmiana listy to nowa migracja.
- Automatyczna aktualizacja słownika z tar1090-db — skrypt generatora uruchamia się ręcznie, a wynik wchodzi nową
  migracją.
- Pseudo-typy bez nazwy (`TWR`, `GND`, …) w słowniku — da się je dodać tylko jako kod spoza słownika.
- Zmiana limitu 20 typów, schematu `alert_settings` ani endpointu `POST /api/settings`.
- Flaga wojskowa (FR-007) — odłożona w roadmapie.

## Implementation Approach

Słownik w tabeli `public.aircraft_types` (kod, nazwa, flaga `featured`) wypełnionej migracją generowaną skryptem
z tar1090-db. Wyszukiwanie przez `GET /api/aircraft-types?q=` (klucz `anon`, RLS: odczyt dla zalogowanych),
z normalizacją zapytania i rankingiem w czystym module `src/lib/aircraft-types.ts`. Strona `/settings` przy
renderowaniu ładuje wyróżnione typy i nazwy już wybranych kodów; wyspa React pyta endpoint tylko przy wyszukiwaniu.
Wybierak trzyma listę kodów w stanie i oddaje ją formularzowi przez ukryte pole, więc ścieżka zapisu się nie zmienia.

## Critical Implementation Details

- **Bezpieczny filtr `or` PostgREST:** zapytanie trafia do `.or("code.ilike.Q%,name.ilike.%Q%")`, gdzie przecinek,
  nawias, `%`, `_` i `*` zmieniłyby znaczenie filtra. Normalizacja w `src/lib/aircraft-types.ts` przepuszcza tylko
  `[A-Za-z0-9 \-/]` i odrzuca resztę (wynik `null` → pusta lista), zanim cokolwiek trafi do filtra. Ten sam warunek
  chroni zapytanie strony `/settings`, które wstawia zapisane kody do `code.in.(…)`: kody przeszły już domenę
  `icao_type`, ale strona i tak filtruje je przez `ICAO_TYPE_PATTERN`.
- **Ukryte pole jest jedynym nośnikiem typów:** pole wyszukiwania w wybieraku nie może mieć atrybutu `name`, inaczej
  `FormData` wyśle wpisany tekst jako drugi parametr formularza.

## Faza 1: Słownik typów w bazie

### Overview

Tabela `aircraft_types` z pełną listą 2774 nazwanych typów i 14 wyróżnionymi, dostępna do odczytu dla zalogowanych.

### Changes Required:

#### 1. Generator migracji słownika

**File**: `scripts/aircraft-types-seed.mjs`, `package.json`

**Intent**: Powtarzalne źródło danych słownika: pobiera `db/icao_aircraft_types2.js` z tar1090-db, rozpakowuje gzip
(`node:zlib`), pomija wpisy z pustą nazwą i kody spoza `^[A-Z0-9]{2,4}$`, oznacza 14 wyróżnionych i wypisuje SQL
`insert` na stdout. Brak któregoś z wyróżnionych w źródle przerywa skrypt z błędem.

**Contract**: skrypt `npm run aircraft-types:seed` (`node scripts/aircraft-types-seed.mjs`); wyjście: wielowierszowe
`insert into public.aircraft_types (code, name, featured) values (…)` posortowane po kodzie, nazwy z apostrofami
podwojonymi (dziś ich nie ma, ale generator nie może na tym polegać). Wyróżnione:
`A400, C17, C30J, C130, A124, IL76, AN12, BLCF, A3ST, B748, K35R, E3TF, B52, H47`. Nagłówek SQL podaje źródło
(URL + data pobrania).

#### 2. Migracja tabeli i danych

**File**: `supabase/migrations/<timestamp>_aircraft_types.sql`

**Intent**: Tabela słownika z polityką tylko do odczytu dla zalogowanych i dane z generatora w tej samej migracji,
żeby produkcja dostała słownik razem ze schematem.

**Contract**: `public.aircraft_types (code public.icao_type primary key, name text not null check (name <> ''),
featured boolean not null default false)`. `revoke all … from anon, authenticated; grant select … to authenticated`;
RLS włączone, jedna polityka `for select to authenticated using (true)`. Bez polityk insert/update/delete. Na końcu
wklejony wynik generatora. Komentarze po polsku, jak w poprzednich migracjach.

#### 3. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Regeneracja typów, żeby `createClient()` znał nową tabelę.

**Contract**: `npm run db:types` po `supabase db reset` (lub `migration up`); w pliku pojawia się `aircraft_types`.

#### 4. Test pgTAP

**File**: `supabase/tests/aircraft_types_rls.sql`

**Intent**: Pilnuje granicy uprawnień i danych: zalogowany czyta, nikt z aplikacji nie pisze, anonim nie czyta,
wyróżnionych jest dokładnie 14 i każdy ma nazwę.

**Contract**: wzorzec `cron_runs_rls.sql`: `has_table`, RLS włączone, dokładnie jedna polityka; jako `authenticated`:
`select` zwraca > 2000 wierszy, `count(*) where featured` = 14, `insert`/`update`/`delete` rzucają `42501`; jako `anon`:
`select` rzuca `42501`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się na czystej bazie: `supabase db reset`
- Testy pgTAP przechodzą: `npm run test:db`
- `src/db/database.types.ts` zawiera tabelę `aircraft_types` po `npm run db:types`
- Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check`

#### Manual Verification:

- W Supabase Studio tabela `aircraft_types` ma ~2774 wiersze, a 14 wyróżnionych ma czytelne nazwy

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Faza 2: Wyszukiwanie typów

### Overview

Czysty moduł normalizacji i rankingu oraz endpoint `GET /api/aircraft-types?q=` zwracający do 20 trafień.

### Changes Required:

#### 1. Moduł słownika

**File**: `src/lib/aircraft-types.ts`, `src/lib/aircraft-types.test.ts`

**Intent**: Wspólne dla endpointu i wyspy (bez importów serwerowych): normalizacja zapytania i kolejność wyników,
żeby „C17” znajdowało C-17 przed typami, które mają „C17” gdzieś w nazwie.

**Contract**:

- `interface AircraftType { code: string; name: string }`, `SEARCH_MIN_LENGTH = 2`, `SEARCH_MAX_LENGTH = 40`,
  `SEARCH_LIMIT = 20`.
- `normalizeTypeQuery(raw: string): string | null` — `trim`, sklejenie spacji; `null`, gdy długość poza 2–40 albo
  znak spoza `[A-Za-z0-9 \-/]`.
- `rankAircraftTypes(query: string, types: AircraftType[]): AircraftType[]` — kolejność: kod równy zapytaniu
  (bez względu na wielkość liter) → kod zaczynający się od zapytania → nazwa zawierająca zapytanie; w obrębie grupy
  po kodzie rosnąco; obcięte do `SEARCH_LIMIT`.
- Testy (Vitest, `describe`/`it`/`expect` z `vitest`): normalizacja (za krótkie, za długie, znaki `,%()_*`, spacje,
  „il-76/82” przechodzi), ranking (dokładny kod pierwszy, prefiks przed nazwą, wielkość liter, limit 20).

#### 2. Endpoint wyszukiwania

**File**: `src/pages/api/aircraft-types.ts`

**Intent**: Wyszukiwanie w słowniku dla wyspy, kluczem `anon` pod RLS.

**Contract**: `export const GET: APIRoute`. Brak `locals.user` → redirect na `/auth/signin` (jak `probe.ts`);
`createClient()` `null` → 503 JSON. `q` po `normalizeTypeQuery` równe `null` → 200 `{ types: [] }` (pisanie pierwszej
litery to nie błąd). W pozostałych przypadkach `select("code, name").or(…).limit(50)`, potem `rankAircraftTypes` → 200
`{ types: AircraftType[] }`. Błąd bazy → 500 `{ error: "search_failed" }` i `console.error` z detalem (bez detalu
w odpowiedzi). Nagłówki: `Content-Type: application/json`, `Cache-Control: no-store`.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Dowód, że endpoint jest prywatny i działa na prawdziwej bazie.

**Contract**: krok anonimowy „aircraft types search redirects anonymous user” → 302 na `/auth/signin`; krok po
zalogowaniu „aircraft types search finds A400” (`/api/aircraft-types?q=a400`) → 200, `bodyIncludes: ["A400",
"AIRBUS A-400M"]`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Smoke przechodzi na lokalnej bazie i działającym `npm run dev`: `npm run smoke`
- Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check`

#### Manual Verification:

- Zalogowany `GET /api/aircraft-types?q=c17` zwraca C17 jako pierwszy wynik, a `q=hercules` zwraca C130 i C30J

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Faza 3: Wyspa wyboru w ustawieniach

### Overview

Komponent `AircraftTypePicker` zastępuje pole tekstowe; strona `/settings` dostarcza wyróżnione typy i nazwy
zapisanych kodów.

### Changes Required:

#### 1. Dane dla wybieraka

**File**: `src/pages/settings.astro`

**Intent**: Jedno dodatkowe zapytanie kluczem `anon` o wyróżnione typy i nazwy zapisanych kodów, żeby chipy i lista
wyróżnionych miały nazwy od pierwszego renderu bez pytania endpointu.

**Contract**: `from("aircraft_types").select("code, name, featured")` z filtrem `featured.eq.true` lub
`code.in.(<zapisane kody>)` (kody przefiltrowane przez `ICAO_TYPE_PATTERN`). Do wyspy idą nowe propsy
`featuredTypes: AircraftType[]` (posortowane po nazwie) i `typeNames: Record<string, string>`. Błąd tego zapytania nie
psuje strony: `featuredTypes = []`, `typeNames = {}`, `console.error`, a wybierak pokazuje komunikat, że lista
wyróżnionych jest chwilowo niedostępna (wyszukiwanie i zapisane chipy dalej działają).

#### 2. Komponent wybieraka

**File**: `src/components/settings/AircraftTypePicker.tsx`

**Intent**: Interaktywny wybór typów zgodny z FR-002: wyróżnione przełączniki, wyszukiwarka z podpowiedziami,
chipy wybranych, ukryte pole dla formularza.

**Contract**:

- Propsy: `selected: string[]`, `onChange(codes: string[])`, `featuredTypes: AircraftType[]`,
  `typeNames: Record<string, string>`.
- Ukryte `<input type="hidden" name="aircraft_types" value={selected.join(",")}>`; pole wyszukiwania bez `name`.
- Wyróżnione: przyciski z `aria-pressed`, etykieta „<nazwa> · <kod>”; kliknięcie dodaje lub usuwa kod.
- Szukaj: `fetch("/api/aircraft-types?q=…")` po 250 ms ciszy, tylko gdy `normalizeTypeQuery` nie zwraca `null`;
  odpowiedź do starszego zapytania jest ignorowana. Wyniki jako lista przycisków; już wybrane oznaczone i nieaktywne.
  Gdy zapytanie po `toUpperCase()` pasuje do `ICAO_TYPE_PATTERN` i nie ma go w wynikach: opcja „Add code XXXX”.
  Stany: „Searching…”, „No matching types”, błąd sieci lub HTTP → „Search is unavailable right now”. Odpowiedź będąca
  przekierowaniem (wygasła sesja) traktowana jak błąd.
- Wybrane: chipy „<nazwa> · <kod>” albo „<kod> · unknown name” z przyciskiem usunięcia (`aria-label="Remove <kod>"`);
  licznik „n/20”. Przy 20 wybranych dodawanie jest nieaktywne z podpowiedzią o limicie (`MAX_AIRCRAFT_TYPES`).
- Nazwy dodanych z wyszukiwania trafiają do lokalnej mapy nazw, żeby chip pokazał nazwę bez ponownego zapytania.
- Styl spójny z formularzem (`bg-white/10`, `border-white/20`, `text-blue-100/50` dla podpowiedzi), klasy przez `cn()`,
  ikony z `lucide-react`.

#### 3. Podpięcie w formularzu

**File**: `src/components/settings/AlertSettingsForm.tsx`

**Intent**: Zamiana `FormField` typów na wybierak; walidacja przy wysyłce dalej przez `parseAlertSettingsForm`.

**Contract**: stan `types` zmienia się ze `string` na `string[]` (z `initial.aircraft_types`); nowe propsy
`featuredTypes` i `typeNames` przekazane z `settings.astro`. `handleSubmit` bez zmian — ukryte pole jest w
`FormData`.

### Success Criteria:

#### Automated Verification:

- Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check`
- Testy jednostkowe przechodzą: `npm test`
- Build przechodzi: `npm run build`
- Smoke przechodzi (zapis ustawień z `aircraft_types` dalej działa): `npm run smoke`

#### Manual Verification:

- Na `/settings` widać 14 wyróżnionych z nazwami; kliknięcie dodaje chip, ponowne usuwa
- Wyszukanie „globemaster” dodaje C17 z nazwą; „Add code ZZZZ” dodaje chip „ZZZZ · unknown name”
- Zapis i ponowne wejście pokazują te same chipy w tej samej kolejności; wcześniej zapisane kody spoza słownika nie
  giną
- Przy 20 wybranych dodawanie jest zablokowane z podpowiedzią
- Klawiatura: Tab dochodzi do przełączników, wyników i przycisków usunięcia; Enter w polu wyszukiwania nie wysyła
  formularza
- Na szerokości telefonu (375 px) wybierak mieści się bez przewijania w poziomie

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- `src/lib/aircraft-types.test.ts`: `normalizeTypeQuery` (granice długości 1/2/40/41, znaki sterujące filtrem
  PostgREST, spacje wielokrotne), `rankAircraftTypes` (dokładny kod > prefiks kodu > nazwa, wielkość liter, sortowanie
  w grupie po kodzie, limit 20).
- `src/lib/alert-settings.test.ts` bez zmian — ścieżka parsowania się nie zmienia.

### Integration Tests:

- pgTAP `aircraft_types_rls.sql`: uprawnienia `authenticated`/`anon`, liczba wyróżnionych.
- Smoke: endpoint prywatny, wyszukiwanie zwraca A400 z nazwą, zapis ustawień z typami dalej 302 na `?saved=1`.

### Manual Testing Steps:

1. Zaloguj się, otwórz `/settings`, zaznacz A400 i C17 z wyróżnionych, zapisz, odśwież — oba chipy z nazwami.
2. Wyszukaj „747”, dodaj B744 z wyników; wpisz „zzzz”, wybierz „Add code ZZZZ”, zapisz — chip „ZZZZ · unknown name”.
3. Dodaj typy do 20 i sprawdź blokadę; usuń jeden i sprawdź, że dodawanie wraca.
4. Wyłącz sieć (DevTools offline), wpisz zapytanie — komunikat o niedostępnym wyszukiwaniu, formularz dalej działa.

## Performance Considerations

~2774 wiersze: `ilike '%…%'` po nazwie to pełny skan małej tabeli, rzędu milisekund, więc bez indeksu trigramowego.
Endpoint pobiera do 50 wierszy i rankuje w pamięci. Debounce 250 ms ogranicza liczbę zapytań przy pisaniu. Słownik
nie trafia do bundla Workera (`infrastructure.md:107`).

## Migration Notes

Migracja tylko dodaje tabelę i dane; `alert_settings` się nie zmienia. Na produkcji migracja idzie przed wdrożeniem
Workera (jak dotąd). Aktualizacja słownika w przyszłości: uruchomić generator i dodać nową migrację z
`insert … on conflict (code) do update set name = excluded.name` (bez zmiany flag `featured`).

## References

- Roadmapa: `context/foundation/roadmap.md` (S-06)
- PRD: `context/foundation/prd.md` (FR-002, FR-005)
- Źródło danych i `desc`: `context/foundation/adsb-source.md`
- Ryzyko czasu startu: `context/foundation/infrastructure.md:107`
- Wzorzec tabeli z RLS: `supabase/migrations/20260928084032_alert_settings.sql:26-43`
- Wzorzec endpointu JSON: `src/pages/api/adsb/probe.ts`
- Wzorzec pgTAP: `supabase/tests/cron_runs_rls.sql`
- Słownik: `https://github.com/wiedehopf/tar1090-db` (`db/icao_aircraft_types2.js`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Słownik typów w bazie

#### Automated

- [x] 1.1 Migracja aplikuje się na czystej bazie: `supabase db reset` — 081d7ea
- [x] 1.2 Testy pgTAP przechodzą: `npm run test:db` — 081d7ea
- [x] 1.3 `src/db/database.types.ts` zawiera tabelę `aircraft_types` po `npm run db:types` — 081d7ea
- [x] 1.4 Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check` — 081d7ea

#### Manual

- [x] 1.5 W Supabase Studio tabela `aircraft_types` ma ~2774 wiersze, a 14 wyróżnionych ma czytelne nazwy — 081d7ea

### Phase 2: Wyszukiwanie typów

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm test` — 0f73fd7
- [x] 2.2 Smoke przechodzi na lokalnej bazie i działającym `npm run dev`: `npm run smoke` — 0f73fd7
- [x] 2.3 Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check` — 0f73fd7

#### Manual

- [x] 2.4 Zalogowany `GET /api/aircraft-types?q=c17` zwraca C17 jako pierwszy wynik, a `q=hercules` zwraca C130 i C30J — 0f73fd7

### Phase 3: Wyspa wyboru w ustawieniach

#### Automated

- [x] 3.1 Lint i typy przechodzą: `npm run lint && npx astro sync && npx astro check`
- [x] 3.2 Testy jednostkowe przechodzą: `npm test`
- [x] 3.3 Build przechodzi: `npm run build`
- [x] 3.4 Smoke przechodzi (zapis ustawień z `aircraft_types` dalej działa): `npm run smoke`

#### Manual

- [x] 3.5 Na `/settings` widać 14 wyróżnionych z nazwami; kliknięcie dodaje chip, ponowne usuwa
- [x] 3.6 Wyszukanie „globemaster” dodaje C17 z nazwą; „Add code ZZZZ” dodaje chip „ZZZZ · unknown name”
- [x] 3.7 Zapis i ponowne wejście pokazują te same chipy w tej samej kolejności; wcześniej zapisane kody spoza słownika nie giną
- [x] 3.8 Przy 20 wybranych dodawanie jest zablokowane z podpowiedzią
- [x] 3.9 Klawiatura: Tab dochodzi do przełączników, wyników i przycisków usunięcia; Enter w polu wyszukiwania nie wysyła formularza
- [x] 3.10 Na szerokości telefonu (375 px) wybierak mieści się bez przewijania w poziomie
