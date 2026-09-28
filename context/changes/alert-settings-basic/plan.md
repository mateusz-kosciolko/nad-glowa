# Podstawowe ustawienia alertów (S-02) — plan implementacji

## Overview

Zalogowany użytkownik zapisuje i zmienia przybliżoną lokalizację domu (~1 km), promień obserwacji (wstępnie 30 km) i listę kodów typów samolotów na chronionym ekranie `/settings`. Inni użytkownicy nigdy tych danych nie widzą. Warstwa danych jest już zaprojektowana i zatwierdzona (`docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`) i ma gotowy plan migracji (`docs/superpowers/plans/2026-09-24-alert-settings-rls.md`, Task 1 i Task 3). Ta zmiana wdraża ten schemat, dokłada do niego ekran i endpoint zapisu, a potem wypycha całość na produkcję. To element roadmapy **S-02 `alert-settings-basic`**, który zasila north star S-03.

## Current State Analysis

- **Baza:** brak `supabase/migrations/`, jest tylko `supabase/config.toml` (Postgres 17). Zatwierdzony spec definiuje `public.alert_settings` z kolumnami `user_id` (PK = `auth.users.id`), `home_lat`/`home_lon numeric(5,2)` (nullable), `radius_km integer default 30` (1–100), `aircraft_types icao_type[]` (≤ 20), `paused boolean` i `updated_at`. Są dwie polityki RLS (`select` i `update` dla `authenticated`), grants `revoke all from anon`, trigger `security definer` na `auth.users` oraz backfill. Plan `511ba0a` ma gotowy SQL (Task 1 Step 4) i 12 testów pgTAP (Task 1 Step 2).
- **Otwarte założenie ze speca:** nikt jeszcze nie sprawdził empirycznie, czy Postgres egzekwuje domenę `icao_type` na elementach tablicy. Plan `511ba0a` Task 1 Step 5 opisuje ścieżkę awaryjną.
- **Aplikacja:** jedyne endpointy to auth (`src/pages/api/auth/*`), a `/dashboard` to placeholder. `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`). Formularze auth to wyspy React z natywnym `POST` do endpointu, który zgłasza błąd przez redirect z `?error=<encodeURIComponent>` (`src/pages/api/auth/signin.ts:16`, `src/components/auth/SignInForm.tsx:43`). Jest wspólny `FormField`, `SubmitButton` (z `useFormStatus`) i `ServerError`. W `src/components/ui/` jest tylko `button.tsx`.
- **Typy:** `createClient()` (`src/lib/supabase.ts:9`) nie ma generyka `Database`. Przy `tseslint.configs.strictTypeChecked` (`eslint.config.js:17`) wyniki zapytań typu `any` wywołają błędy `no-unsafe-*`.
- **Testy:** `scripts/smoke.mjs` to jedyny test automatyczny. Sprawdza tylko status i `location`, nie treść odpowiedzi. Konto zakłada przez otwartą rejestrację, którą S-01 kiedyś zamknie. CI (`.github/workflows/ci.yml:39`) w jobie `smoke` startuje lokalne Supabase, które stosuje migracje. Repo nie ma remote'a, więc CI na razie nie biega.
- **Produkcja:** Worker `nad-glowa`, Supabase `nwphfexokrngshgmhucf`. `supabase link` wymaga hasła bazy, które zna tylko człowiek (`context/deployment/deploy-plan.md`, „Granica dostępu”). `wrangler rollback` nie cofa migracji.

## Desired End State

- Migracja `alert_settings` działa lokalnie i na produkcji. Testy pgTAP (`npm run test:db`) przechodzą, a CI uruchamia je w jobie `smoke`.
- `/settings` jest chronione przez middleware. Pokazuje bieżące ustawienia użytkownika i pozwala je zapisać: dwa pola lat/lon z przyciskiem „Use my location”, promień z wartością z bazy (domyślnie 30) i pole tekstowe z kodami typów.
- `POST /api/settings` waliduje dane, normalizuje kody, zapisuje przez klienta z kluczem `anon` pod RLS i przekierowuje na `/settings?saved=1` albo `/settings?error=…`.
- Smoke wykonuje uwierzytelniony round-trip zapisu i odczytu, łącznie z zaokrągleniem i normalizacją.
- Na produkcji zalogowany użytkownik zapisuje ustawienia, a po przeładowaniu widzi wartości zaokrąglone do 2 miejsc.

### Key Discoveries:

- Wzorzec endpointu formularza: `src/pages/api/auth/signin.ts:4-20` (formData, `createClient` z obsługą `null`, redirect z `?error=`).
- Wzorzec wyspy formularza: `src/components/auth/SignInForm.tsx:36-43` (natywny POST, walidacja w `onSubmit` z `preventDefault` tylko przy błędzie, `noValidate`).
- Strona przekazuje błąd z query do wyspy: `src/pages/auth/signin.astro:5,14`.
- `numeric(5,2)` zaokrągla przy zapisie. Spec (Global Constraints `511ba0a`) mówi, że aplikacja nie zaokrągla po stronie serwera, bo gwarancją precyzji jest typ kolumny.
- Kolejność configów ESLint jest istotna: nowe wyjątki ignorowania dopisuje się przez `globalIgnores` (`eslint.config.js:83`).

## What We're NOT Doing

- **Granica klucza `service_role`** (Task 2 z `511ba0a`: reguła ESLint, hard rule w `CLAUDE.md`, korekta `deploy-plan.md`). Roadmapa przypisuje ją do F-02.
- **Czytelny wybór typów** (krótka lista z nazwami, wyszukiwanie w pełnej liście, słownik typów). To S-06. Tutaj są wyłącznie kody ICAO w polu tekstowym i nikt nie sprawdza, czy dany kod istnieje.
- **Przełącznik pauzy w UI** (S-05). Kolumna `paused` powstaje w migracji, ale ekran jej nie pokazuje i endpoint jej nie zapisuje.
- **Zamknięcie rejestracji i przepięcie smoke z `/auth/signup`** (S-01).
- **Mapa z pinezką**, geokodowanie adresu i zewnętrzne kafelki.
- **Zmiana celu redirectu po logowaniu** (zostaje `/`).
- Indeksy, tabela powiadomień i log obserwacji (poza zakresem speca).
- **Serwerowe zaokrąglanie współrzędnych.** Robi to typ kolumny.

## Implementation Approach

Kolejność „schemat → typy → backend → UI → produkcja”. Faza 1 realizuje Task 1 z `511ba0a` bez zmian w SQL, bo spec jest zatwierdzony. Dochodzą do niej wygenerowane typy bazy, potrzebne dalszym fazom przy strict lint. Faza 2 dodaje czysty moduł parsowania i walidacji (`src/lib/alert-settings.ts`), z którego korzysta i endpoint, i wyspa. Dzięki temu reguły są w jednym miejscu, a serwer i tak ma ostatnie słowo. Faza 3 buduje ekran zgodnie z wzorcem formularzy auth i rozszerza smoke. Faza 4 wypycha migrację przed deployem kodu, bo `/settings` odpytuje tabelę.

## Critical Implementation Details

**Kolejność na produkcji:** `supabase db push` musi się udać **przed** `wrangler deploy`. Kod faz 2–3 odpytuje `alert_settings`, więc deploy bez tabeli daje błąd na `/settings`. Rollback Workera nie cofa migracji, a migracja jest addytywna, więc bez tabeli stary kod działa jak dotąd.

**Utrata wpisanych danych przy błędzie:** redirect z `?error=` renderuje formularz od nowa z wartościami z bazy. Dlatego wyspa uruchamia przed wysłaniem tę samą walidację co serwer (`parseAlertSettingsForm`). Błędy wykrywalne po stronie klienta nigdy nie wymagają wtedy round-tripu.

**Geolokacja:** wyspa zaokrągla wynik `navigator.geolocation` do 2 miejsc, zanim wpisze go w pola. Dokładna pozycja nie opuszcza wtedy przeglądarki. To dodatkowa warstwa prywatności, a nie gwarancja precyzji, bo gwarancją pozostaje `numeric(5,2)`.

---

## Faza 1: Schemat i testy bazy

### Overview

Wdrożyć lokalnie migrację `alert_settings` z RLS, triggerem i backfillem zgodnie z `511ba0a` Task 1. Dołożyć testy pgTAP, skrypty npm, krok w CI i wygenerowane typy bazy.

### Changes Required:

#### 1. Bramka ręczna: Docker i lokalne Supabase

**File**: brak (środowisko)

**Intent**: `supabase start` wymaga działającego demona Docker, a cała pętla testowa tej fazy stoi na lokalnej bazie.

**Contract**: kroki z `511ba0a` Task 0: `open -a Docker`, oczekiwanie na `docker info`, potem `npx supabase start`.

#### 2. Migracja

**File**: `supabase/migrations/<timestamp>_alert_settings.sql` (nazwę generuje `npx supabase migration new alert_settings`)

**Intent**: pierwszy schemat bazy: domena `icao_type`, tabela `alert_settings`, grants, RLS (tylko `select` i `update` dla `authenticated`), trigger `handle_new_user` i backfill istniejących kont.

**Contract**: SQL jak w `docs/superpowers/plans/2026-09-24-alert-settings-rls.md`, Task 1 Step 4, z jedną zmianą: przed `grant select, update … to authenticated` dodaj `revoke all on public.alert_settings from authenticated;`. Domyślne uprawnienia Supabase na schemacie `public` dają `authenticated` wszystkie prawa do nowych tabel, a `grant` ich nie odbiera. Bez tego `revoke` nie działa druga warstwa (brak `insert`/`delete` na poziomie uprawnień), którą obiecuje komentarz w migracji. Jeśli `db reset` i testy wykażą, że domena nie działa na elementach tablicy, zastosuj ścieżkę awaryjną z Task 1 Step 5: kolumna `text[]`, bez domeny, ale z ograniczeniem tabeli `constraint types_format check (array_to_string(aircraft_types, ',') ~ '^([A-Z0-9]{2,4}(,[A-Z0-9]{2,4})*)?$')`. Walidacja zostaje własnością bazy, a asercja #8 (kod `23514`) i `plan(12)` pozostają ważne.

#### 3. Testy pgTAP

**File**: `supabase/tests/alert_settings_rls.sql`

**Intent**: jedyny automatyczny dowód, że polityki, trigger, zaokrąglenie i ograniczenia działają. Test powstaje przed migracją i najpierw musi paść.

**Contract**: treść z `511ba0a` Task 1 Step 2 (`plan(12)`) z jedną zmianą: asercja „trigger utworzył wiersz dla każdego nowego konta” liczy tylko wiersze testowe (`where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')`). Dzięki temu test nie pada na lokalnej bazie z kontami założonymi przez smoke. Jeśli obraz bazy nie ma pgTAP, dopisz `pgtap` do `[db.extensions]` w `supabase/config.toml`.

#### 4. Skrypty npm

**File**: `package.json`

**Intent**: jednolite polecenia do testów bazy i regeneracji typów.

**Contract**: `"test:db": "supabase test db"` oraz `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`.

#### 5. Typy bazy

**File**: `src/db/database.types.ts` (generowany, commitowany)

**Intent**: typ `Database`, dzięki któremu zapytania supabase-js są typowane i przechodzą `strictTypeChecked`.

**Contract**: wynik `npm run db:types` po `db reset`. Jeśli plik łamie lint lub Prettier, dodaj go do `globalIgnores` w `eslint.config.js` i do `.prettierignore`, zamiast ręcznie go edytować.

#### 6. CI

**File**: `.github/workflows/ci.yml`

**Intent**: testy bazy mają biegać w jobie, który i tak startuje Supabase.

**Contract**: w jobie `smoke`, zaraz po kroku `Start local Supabase`, dodaj krok `name: Run database tests` z `run: supabase test db`.

#### 7. Korekta speca

**File**: `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`

**Intent**: domknąć odstępstwo odnotowane w `511ba0a` (backfill) i zapisać wynik weryfikacji domeny.

**Contract**: w sekcji `## Trigger` akapit o backfillu dla kont sprzed migracji. Przy grantach zdanie o `revoke all … from authenticated` (odstępstwo od zatwierdzonego SQL, patrz §2). W akapicie „Domena `icao_type` wymaga weryfikacji lokalnej” zdanie z wynikiem: potwierdzone albo zastosowano ścieżkę awaryjną.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się bez błędów: `npx supabase db reset`
- Wszystkie 12 asercji pgTAP przechodzi: `npm run test:db`
- Typy wygenerowane i zawierają tabelę: `npm run db:types && grep -q alert_settings src/db/database.types.ts`
- Krok testów bazy jest w CI: `grep -q "supabase test db" .github/workflows/ci.yml`
- Lint i typecheck czyste: `npm run lint && npx astro sync && npx astro check`

#### Manual Verification:

- Spec zawiera akapit o backfillu i wynik weryfikacji domeny na tablicy

**Implementation Note**: po zielonej weryfikacji automatycznej zatrzymaj się na ręcznym potwierdzeniu, zanim przejdziesz do fazy 2.

---

## Faza 2: Zapis ustawień (backend)

### Overview

Typowany klient Supabase, czysty moduł parsowania i walidacji oraz endpoint `POST /api/settings`, który zapisuje pod RLS.

### Changes Required:

#### 1. Typowany klient

**File**: `src/lib/supabase.ts`

**Intent**: wszystkie zapytania mają znać schemat bazy.

**Contract**: `createServerClient<Database>(…)` z typem importowanym z `@/db/database.types`. Sygnatura `createClient()` i zwracany `null` pozostają bez zmian.

#### 2. Moduł ustawień

**File**: `src/lib/alert-settings.ts` (nowy, bez importów serwerowych, żeby dało się go użyć w wyspie)

**Intent**: jedno źródło reguł formularza dla serwera i klienta.

**Contract**:

- Stałe: `RADIUS_MIN = 1`, `RADIUS_MAX = 100`, `MAX_AIRCRAFT_TYPES = 20`, `ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/`. Muszą zgadzać się z ograniczeniami migracji.
- `parseAircraftTypes(raw: string): string[]` dzieli po przecinkach, średnikach i białych znakach, przycina, zamienia na wielkie litery, pomija puste wpisy i usuwa duplikaty z zachowaniem kolejności pierwszego wystąpienia. Na przykład `"b744, a400 B744"` daje `["B744", "A400"]`.
- `parseAlertSettingsForm(form: FormData)` zwraca `{ ok: true; value: { home_lat: number | null; home_lon: number | null; radius_km: number; aircraft_types: string[] } }` albo `{ ok: false; error: string }`. Pola formularza: `home_lat`, `home_lon`, `radius_km`, `aircraft_types`. Reguły:
  - Lat i lon są oba puste (wtedy `null`) albo oba podane. Tylko jedno z nich daje błąd.
  - Parsowanie liczb: przytnij, pusty ciąg traktuj jako brak wartości (nie `Number("") === 0`), zamień `,` na `.` (polski separator dziesiętny), potem `Number()`.
  - Wartość musi być liczbą skończoną (`Number.isFinite`). Lat w [-90, 90], lon w [-180, 180], sprawdzane przed zaokrągleniem. Serwer nie zaokrągla.
  - Promień jest wymagany i musi być liczbą całkowitą w [`RADIUS_MIN`, `RADIUS_MAX`].
  - Każdy znormalizowany kod musi pasować do `ICAO_TYPE_PATTERN`, a komunikat błędu wymienia pierwszy niepoprawny kod. Kodów może być najwyżej `MAX_AIRCRAFT_TYPES`. Pusta lista jest dozwolona.
- Komunikaty są po angielsku, spójnie z formularzami auth.

#### 3. Endpoint zapisu

**File**: `src/pages/api/settings.ts` (nowy)

**Intent**: zapisać ustawienia zalogowanego użytkownika zgodnie z konwencją endpointów formularzy.

**Contract**: `export const POST: APIRoute`. Przebieg:

1. Brak `context.locals.user` daje redirect `/auth/signin`.
2. `createClient()` zwraca `null`, więc redirect `/settings?error=Supabase is not configured`.
3. Walidacja przez `parseAlertSettingsForm`. Błąd daje redirect `/settings?error=<encodeURIComponent>`.
4. `update({ ...value, updated_at: <now ISO> }).eq("user_id", user.id).select("user_id")`. Błąd Supabase daje redirect z `error.message`. Zero zaktualizowanych wierszy daje redirect z komunikatem o braku wiersza ustawień, co oznacza, że trigger albo backfill zawiódł.
5. Sukces daje redirect `/settings?saved=1`.

Pole `paused` nie jest dotykane.

#### 4. Ochrona tras

**File**: `src/middleware.ts`

**Intent**: `/settings` i jego endpoint wymagają logowania (Access Control z PRD).

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/settings", "/api/settings"]`. Endpoint i tak sprawdza `locals.user`, bo tego wymaga zawężenie typu.

### Success Criteria:

#### Automated Verification:

- Lint i typecheck czyste: `npm run lint && npx astro sync && npx astro check`
- Build przechodzi: `npm run build`
- Anonimowy `POST /api/settings` na dev serwerze zwraca `302` na `/auth/signin`: przy działającym `npm run dev` polecenie `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST -H 'Origin: http://localhost:4321' http://localhost:4321/api/settings` wypisuje `302 http://localhost:4321/auth/signin`

#### Manual Verification:

- Przegląd `src/lib/alert-settings.ts`: stałe zgadzają się z ograniczeniami w migracji (1–100, ≤ 20, `^[A-Z0-9]{2,4}$`)

**Implementation Note**: po zielonej weryfikacji automatycznej zatrzymaj się na ręcznym potwierdzeniu, zanim przejdziesz do fazy 3.

---

## Faza 3: Ekran `/settings`

### Overview

Strona ustawień z wyspą formularza, link z dashboardu i kroki smoke, które dowodzą uwierzytelnionego round-tripu przez RLS na workerd.

### Changes Required:

#### 1. Strona

**File**: `src/pages/settings.astro` (nowy)

**Intent**: wczytać ustawienia użytkownika pod RLS i wyrenderować formularz z bieżącymi wartościami, komunikatem sukcesu albo błędu.

**Contract**:

- `select("home_lat, home_lon, radius_km, aircraft_types").eq("user_id", user.id).maybeSingle()`.
- Do wyspy trafia `initial` (lat i lon jako liczby albo `null`, `radius_km`, `aircraft_types`), `serverError` z `?error=` i `saved` z `?saved=1`.
- Wyspa jest montowana przez `client:load` (jak `src/pages/auth/signin.astro:14`), nigdy `client:only`. Kroki smoke z `bodyIncludes` wymagają wartości w HTML-u z SSR.
- Brak klienta, błąd zapytania albo brak wiersza daje stronę z czytelnym komunikatem zamiast formularza.
- Layout i styl jak `src/pages/dashboard.astro` (`Layout`, `bg-cosmic`, karta).

#### 2. Wyspa formularza

**File**: `src/components/settings/AlertSettingsForm.tsx` (nowy)

**Intent**: formularz ustawień w stylu formularzy auth, z geolokacją i walidacją klienta.

**Contract**:

- `<form method="POST" action="/api/settings" noValidate>` z polami `home_lat`, `home_lon`, `radius_km` i `aircraft_types`. Pole typów pokazuje wartość początkową jako `B744, A400` (`initial.aircraft_types.join(", ")`). Pola lat i lon mają `type="text"` i `inputMode="decimal"`.
- Wykorzystuje `FormField`, `ServerError` i `SubmitButton` z `@/components/auth/`. `FormField` można rozszerzyć o opcjonalne przekazywane atrybuty (np. `inputMode`, `step`), nie zmieniając istniejących wywołań.
- Przycisk „Use my location” (`type="button"`) wywołuje `navigator.geolocation.getCurrentPosition` i wpisuje w pola `latitude`/`longitude` zaokrąglone do 2 miejsc. Brak API albo odmowa zgody daje komunikat pod polami, bez wysyłki.
- `onSubmit` uruchamia `parseAlertSettingsForm(new FormData(form))`. Przy błędzie wywołuje `preventDefault` i pokazuje komunikat, a przy sukcesie wysyła formularz natywnie.
- `saved` pokazuje potwierdzenie zapisu.
- Podpowiedź przy lokalizacji mówi, że jest zapisywana w przybliżeniu (~1 km), a przy typach, że chodzi o kody ICAO oddzielone przecinkami (maks. 20).

#### 3. Link z dashboardu

**File**: `src/pages/dashboard.astro`

**Intent**: po zalogowaniu da się dotrzeć do ustawień.

**Contract**: link „Alert settings” do `/settings` w karcie, obok przycisku wylogowania.

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: pierwszy automatyczny test uwierzytelnionego zapisu i odczytu przez RLS na workerd.

**Contract**:

- `request()` zwraca też `body` (tekst odpowiedzi). Oczekiwanie kroku przyjmuje opcjonalne `bodyIncludes: string[]`.
- Nowe kroki, w kolejności:
  - (przed signup) `GET /settings` anonimowo daje `302` → `/auth/signin`.
  - (po „dashboard renders for signed-in user”) `GET /settings` daje `200`.
  - `POST /api/settings` z `home_lat=52.23456`, `home_lon=21.01178`, `radius_km=25` i `aircraft_types=b744, a400 B744` daje `302` → `/settings?saved=1`.
  - `GET /settings` daje `200`, a body zawiera `52.23`, `21.01` i `B744, A400`.
  - `POST /api/settings` z `radius_km=0` daje `302` → `/settings?error=`.
  - (po signout) `POST /api/settings` daje `302` → `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- Lint, typecheck i build czyste: `npm run lint && npx astro sync && npx astro check && npm run build`
- Smoke przechodzi w całości, łącznie z nowymi krokami: `npm run dev` z lokalnym Supabase, potem `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- Świeże konto na `/settings` widzi promień 30 i puste pola lokalizacji
- „Use my location” wypełnia pola wartościami z 2 miejscami po przecinku
- Zapis pokazuje potwierdzenie, a po przeładowaniu widać zaokrąglone współrzędne i znormalizowane kody
- Błędne dane (tylko lat, promień 150, kod `B7444`) pokazują błąd bez wysyłki formularza
- Dashboard ma działający link do `/settings`

**Implementation Note**: po zielonej weryfikacji automatycznej zatrzymaj się na ręcznym potwierdzeniu, zanim przejdziesz do fazy 4.

---

## Faza 4: Produkcja

### Overview

Wypchnąć migrację na produkcyjną bazę (`511ba0a` Task 3), a potem wdrożyć kod i zweryfikować ekran na produkcji. Kolejność: najpierw baza, potem Worker.

### Changes Required:

#### 1. Połączenie z projektem (człowiek)

**File**: brak

**Intent**: `supabase link` wymaga hasła bazy, które zna tylko człowiek.

**Contract**: `npx supabase link --project-ref nwphfexokrngshgmhucf`.

#### 2. Push migracji

**File**: brak

**Intent**: zastosować jedną migrację na produkcji po obejrzeniu jej listy.

**Contract**: `npx supabase db push --dry-run` musi pokazać dokładnie jeden plik `*_alert_settings.sql`. Każdy inny wynik oznacza stop. Dopiero potem `npx supabase db push`.

#### 3. Deploy Workera

**File**: brak

**Intent**: wdrożyć kod faz 2–3 dopiero po udanym pushu.

**Contract**: `npm run build && npx wrangler deploy` (jedyna dozwolona komenda wdrożeniowa). **Nie** uruchamiaj `npm run smoke` przeciwko produkcji.

#### 4. Zapis stanu wdrożenia

**File**: `context/deployment/deploy-plan.md`

**Intent**: ścieżka audytowa wdrożenia.

**Contract**:

- Frontmatter `version_id` zmienia się na nową wersję.
- „Co zostało wdrożone” wspomina ekran `/settings`.
- W tabeli „Czego NIE wdrożono” wiersz `Migracje Supabase / RLS` zostaje przekreślony z adnotacją „Częściowo zamknięte 2026-MM-DD: `alert_settings` z RLS na produkcji; pozostają tabele powiadomień (FR-009/FR-010) i logu obserwacji (FR-011)”.
- Poprzednia wersja jest zapisana w sekcji Rollback.

### Success Criteria:

#### Automated Verification:

- Dry-run pokazuje dokładnie jedną migrację: `npx supabase db push --dry-run`
- Migracja zastosowana: `npx supabase db push`
- Deploy udany: `npm run build && npx wrangler deploy`
- Produkcja: `/` zwraca `200`, a anonimowe `/settings` zwraca `302` → `/auth/signin` (curl)

#### Manual Verification:

- Człowiek połączył projekt przez `npx supabase link`
- SQL Editor w panelu: dwie polityki (`SELECT` i `UPDATE`) dla `{authenticated}`, a liczba `auth.users` równa się liczbie `alert_settings`
- Na produkcji kontem z panelu: zapis ustawień, a po przeładowaniu widać zaokrąglone wartości
- `context/deployment/deploy-plan.md` odnotowuje nową wersję i migrację

---

## Testing Strategy

### Unit Tests:

- Brak test runnera w projekcie (`CLAUDE.md`). Reguły `parseAlertSettingsForm` weryfikuje smoke (ścieżka poprawna i promień 0) oraz walidacja w wyspie przy ręcznym teście.

### Integration Tests:

- pgTAP (12 asercji): RLS, brak `insert` i `delete`, trigger, zaokrąglenie, ograniczenia, domena.
- Smoke: anonimowe redirecty dla `/settings` i `/api/settings`, uwierzytelniony zapis i odczyt przez RLS na workerd, normalizacja kodów, zaokrąglenie, błąd walidacji.

### Manual Testing Steps:

1. Zaloguj się lokalnie świeżym kontem, wejdź na `/settings` i sprawdź wartości domyślne.
2. Użyj „Use my location”, zapisz, przeładuj i sprawdź zaokrąglenie.
3. Wpisz `b744 a400, b744`, zapisz i sprawdź, czy widać `B744, A400`.
4. Wypróbuj błędne dane: tylko lat, promień 150, kod `B7444`, 21 kodów.

## Performance Considerations

Jeden wiersz na użytkownika i jedno zapytanie na widok albo zapis. `types_bounded` (≤ 20) chroni przyszłego pollera. Indeksy celowo nie powstają (spec).

## Migration Notes

- Migracja jest addytywna. Backfill tworzy wiersze dla kont istniejących przed migracją, w tym konta testowego z panelu.
- `wrangler rollback` nie cofa migracji. Po rollbacku Workera tabela zostaje, ale stary kod jej nie używa, więc nic się nie psuje.
- Znany tryb awarii: wyjątek w `handle_new_user()` objawia się przy zakładaniu konta jako „Database error saving new user”. Smoke w CI wykrywa go na kroku rejestracji.

## References

- Spec: `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`
- Plan migracji: `docs/superpowers/plans/2026-09-24-alert-settings-rls.md` (Task 0, Task 1, Task 3; Task 2 należy do F-02)
- Roadmapa: `context/foundation/roadmap.md` (S-02)
- PRD: `context/foundation/prd.md` (FR-003, FR-004, FR-005, Access Control)
- Wzorzec endpointu: `src/pages/api/auth/signin.ts:4-20`
- Wzorzec wyspy: `src/components/auth/SignInForm.tsx:36-86`
- Wzorzec strony: `src/pages/auth/signin.astro`, `src/pages/dashboard.astro`
- Granica dostępu do produkcji: `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat i testy bazy

#### Automated

- [x] 1.1 Migracja stosuje się bez błędów: `npx supabase db reset` — 8ca088d
- [x] 1.2 Wszystkie 12 asercji pgTAP przechodzi: `npm run test:db` — 8ca088d
- [x] 1.3 Typy wygenerowane i zawierają tabelę: `npm run db:types && grep -q alert_settings src/db/database.types.ts` — 8ca088d
- [x] 1.4 Krok testów bazy jest w CI: `grep -q "supabase test db" .github/workflows/ci.yml` — 8ca088d
- [x] 1.5 Lint i typecheck czyste: `npm run lint && npx astro sync && npx astro check` — 8ca088d

#### Manual

- [x] 1.6 Spec zawiera akapit o backfillu i wynik weryfikacji domeny na tablicy — 8ca088d

### Phase 2: Zapis ustawień (backend)

#### Automated

- [x] 2.1 Lint i typecheck czyste: `npm run lint && npx astro sync && npx astro check` — 2671c49
- [x] 2.2 Build przechodzi: `npm run build` — 2671c49
- [x] 2.3 Anonimowy `POST /api/settings` na dev serwerze zwraca `302` na `/auth/signin` — 2671c49

#### Manual

- [x] 2.4 Przegląd `src/lib/alert-settings.ts`: stałe zgadzają się z ograniczeniami w migracji — 2671c49

### Phase 3: Ekran `/settings`

#### Automated

- [x] 3.1 Lint, typecheck i build czyste — 0c3fd04
- [x] 3.2 Smoke przechodzi w całości, łącznie z nowymi krokami ustawień — 0c3fd04

#### Manual

- [x] 3.3 Świeże konto na `/settings` widzi promień 30 i puste pola lokalizacji — 0c3fd04
- [x] 3.4 „Use my location” wypełnia pola wartościami z 2 miejscami po przecinku — 0c3fd04
- [x] 3.5 Zapis pokazuje potwierdzenie, a po przeładowaniu widać zaokrąglone współrzędne i znormalizowane kody — 0c3fd04
- [x] 3.6 Błędne dane pokazują błąd bez wysyłki formularza — 0c3fd04
- [x] 3.7 Dashboard ma działający link do `/settings` — 0c3fd04

### Phase 4: Produkcja

#### Automated

- [x] 4.1 Dry-run pokazuje dokładnie jedną migrację
- [x] 4.2 Migracja zastosowana: `npx supabase db push`
- [x] 4.3 Deploy udany: `npm run build && npx wrangler deploy`
- [x] 4.4 Produkcja: `/` zwraca `200`, a anonimowe `/settings` zwraca `302` → `/auth/signin`

#### Manual

- [x] 4.5 Człowiek połączył projekt przez `npx supabase link`
- [x] 4.6 SQL Editor: dwie polityki dla `{authenticated}`, liczba użytkowników równa liczbie wierszy ustawień
- [x] 4.7 Na produkcji zapis ustawień i odczyt zaokrąglonych wartości po przeładowaniu
- [x] 4.8 `context/deployment/deploy-plan.md` odnotowuje nową wersję i migrację
