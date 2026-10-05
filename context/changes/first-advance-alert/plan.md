# Pierwszy alert przed przelotem (S-03) — plan implementacji

## Overview

S-03 z roadmapy (`first-advance-alert`), gwiazda przewodnia kamienia milowego M-1. Handler `scheduled` dostaje
prawdziwą pracę: co minutę dla każdego aktywnego użytkownika pobiera samoloty z adsb.fi i przewiduje przelot przy
locie po prostej. O samolocie wybranego typu, który przeleci w promieniu za 2–15 min, wysyła powiadomienie na
Telegram. Zmiana wchłania S-04 (`no-repeat-alerts`): ta sama maszyna nie wywoła drugiego alertu przez 60 min
(Open Roadmap Question 4 rozstrzygnięte 2026-10-05). Całość działa lokalnie, jak F-02.

## Current State Analysis

- `runWork()` w `src/workers/scheduled.ts:8` jest pusty. Handler tworzy klienta `service_role`, mierzy czas, zapisuje
  wiersz `cron_runs` i retencję, nigdy nie rzuca (`src/workers/scheduled.ts:20-75`).
- Klient ADS-B `fetchAircraftNear` (`src/lib/adsb.ts:185`) przyjmuje promień w km, przelicza na nm z limitem 250 nm
  i zwraca surowy `AircraftState` (`hex`, `type`, `registration`, `trackDeg`, `groundSpeedKt`, `onGround`,
  `positionAgeS`). Nie filtruje; filtrowanie i predykcja należą do S-03 (`context/foundation/adsb-source.md`).
- `alert_settings` ma `home_lat`/`home_lon numeric(5,2)`, `radius_km`, `aircraft_types icao_type[]` i `paused`
  (`supabase/migrations/20260928084032_alert_settings.sql`). Brak kanału powiadomień. Grant `update` jest na całej
  tabeli, więc nowa kolumna dziedziczy go automatycznie.
- Granica `service_role`: import `supabase-admin` jest dozwolony tylko w `src/workers/scheduled.ts`
  (`eslint.config.js`, hard rule w `CLAUDE.md`). Typ `SupabaseClient` z `@supabase/supabase-js` nie jest objęty
  blokadą (reguła dotyczy `createClient`).
- Formularz ustawień: `src/lib/alert-settings.ts` (wspólne parsowanie serwer/wyspa), `src/pages/api/settings.ts`,
  `src/pages/settings.astro`, `src/components/settings/AlertSettingsForm.tsx`. Trasy `/settings` i `/api/settings*`
  chroni prefiks w `src/middleware.ts:4`.
- Brak runnera testów jednostkowych (`CLAUDE.md`). Vite w projekcie to 8.3; Vitest 5 go wspiera. Node 22.16.
- Środowisko nie ma SMTP; Telegram to jedno wywołanie HTTPS (`context/foundation/infrastructure.md:71`).
- Produkcja: cron i pobieranie ADS-B są odłożone (`## Parked` w roadmapie). Lokalny dev pisze do lokalnego Supabase.

## Desired End State

Przy działającym `npm run dev` i `npm run cron:local` użytkownik z ustawionym domem, typami i chat ID Telegrama
dostaje wiadomość o pasującym samolocie, który według predykcji przeleci w jego promieniu za 2–15 min. Wiadomość
zawiera typ, rejestrację, przewidywany czas, kierunek nadlotu i „Route unknown”. Samolot w promieniu z mniej niż
2 min do najbliższego punktu albo już po nim dostaje alert z oznaczeniem „already close”. Ta sama maszyna nie
wywoła drugiego alertu przez 60 min od wysłania. Każdy wysłany alert jest zapisany w `alert_notifications`, więc
kryterium „≥ 2 min przed najbliższym punktem” da się sprawdzić zapytaniem. Pauza (`paused = true`) wstrzymuje
wysyłkę. Na `/settings` jest pole chat ID i przycisk wiadomości testowej. Logika predykcji i deduplikacji ma testy
Vitest uruchamiane w CI.

### Key Discoveries:

- Promień zapytania musi obejmować zasięg wyprzedzenia: przy 450 kt samolot pokonuje w 15 min ~210 km, a zapytanie
  o sam promień użytkownika widzi tylko maszyny już nad głową. Limit źródła 250 nm (~460 km) wystarcza.
- Limit adsb.fi to 1 zapytanie/s, a nadmiar odpowiedzi 4xx grozi blokadą IP (`context/foundation/adsb-source.md`,
  „Limity i warunki”, „Wskazówki dla S-03”).
- `hex` z prefiksem `~` (TIS-B) nie nadaje się do deduplikacji (`src/lib/adsb.ts:30-32`).
- adsb.fi wymaga podania źródła z linkiem; dotyczy też danych w wiadomości.
- Wzorce: klient zewnętrzny, który nigdy nie rzuca — `src/lib/adsb.ts:185`; endpoint formularza z redirectem
  `?error=` — `src/pages/api/settings.ts`; migracja tylko dla `service_role` z testem pgTAP —
  `supabase/migrations/20260928180224_cron_runs.sql`, `supabase/tests/cron_runs_rls.sql`.

## What We're NOT Doing

- Trasy skąd/dokąd — S-07. Wiadomość zawsze mówi „Route unknown”.
- UI pauzy — S-05. Poller respektuje istniejącą kolumnę `paused`, ale ekran jej nie pokazuje.
- Czytelnego wyboru typów — S-06.
- Przeglądania dziennika alertów (FR-011). Tabela nie ma polityki `select` dla zalogowanych.
- Wdrożenia na produkcję: bez `db push`, bez `wrangler deploy`, bez sekretu Telegrama w Workers Secrets.
- Powiązania czatu przez link `/start` z kodem i `getUpdates` — chat ID wkleja się ręcznie.
- Automatycznego przełączania na adsb.lol po awarii adsb.fi.
- Retencji `alert_notifications` — wiersze zostają jako zalążek logu obserwacji (Open Roadmap Question 8).
- Uwzględniania wysokości i skrętów — predykcja po prostej, jak w Business Logic PRD.

## Implementation Approach

Od czystej logiki do integracji. Faza 1 dodaje Vitest i czyste moduły (predykcja, deduplikacja, treść wiadomości),
pokryte testami przypadków brzegowych, zanim cokolwiek wyśle wiadomość. Faza 2 daje użytkownikowi kanał: chat ID
w ustawieniach, klienta Telegrama i przycisk testowy, więc kanał da się sprawdzić bez czekania na samolot. Faza 3
składa całość w pollerze wpiętym w `runWork()`, z dziennikiem wysłanych alertów, który służy do deduplikacji
i jako dowód kryterium sukcesu. Faza 4 to walidacja na prawdziwym przelocie i aktualizacja dokumentów.

## Critical Implementation Details

- **State sequencing** — najpierw wysyłka na Telegram, potem zapis do `alert_notifications`. Nieudana wysyłka nie
  zostawia wiersza, więc następny bieg sam spróbuje ponownie. Nieudany zapis po udanej wysyłce oznacza możliwą
  powtórkę w następnym biegu; to błąd biegu, nie cichy stan.
- **Sekret w URL-u** — token bota jest częścią adresu `https://api.telegram.org/bot<token>/sendMessage`. Komunikaty
  błędów klienta Telegrama, linie logu i kolumna `cron_runs.error` nigdy nie zawierają URL-a ani tokena.
- **Prywatność w błędach** — komunikaty błędów biegu nie zawierają współrzędnych domu ani chat ID, tylko numer
  porządkowy użytkownika w biegu i przyczynę (np. `user 2: adsb.fi responded with HTTP 429`).

## Faza 1: Predykcja, deduplikacja i treść alertu

### Overview

Runner Vitest dla czystych modułów i trzy czyste funkcje z testami: predykcja przelotu, reguła duplikatu, treść
wiadomości.

### Changes Required:

#### 1. Runner testów

**File**: `package.json`, `vitest.config.ts` (nowy), `.github/workflows/ci.yml`

**Intent**: Pierwszy runner testów jednostkowych, tylko dla czystych modułów `src/lib`. Bez `getViteConfig` z Astro,
żeby testy nie ładowały adaptera Cloudflare ani workerd.

**Contract**: dev dependency `vitest` (^5), skrypt `"test": "vitest run"`. `vitest.config.ts`: alias `@` →
`./src` (jak `paths` w `tsconfig.json`), `test.include: ["src/**/*.test.ts"]`, `environment: "node"`. W CI w jobie
`ci` krok `npm test` po `npm run lint`. Plik konfiguracyjny i testy przechodzą `npm run lint` i `astro check`
(tsconfig obejmuje `**/*`); testy importują `describe`/`it`/`expect` jawnie z `vitest`.

#### 2. Predykcja przelotu

**File**: `src/lib/flyover.ts` (nowy, bez importów serwerowych)

**Intent**: Jedno miejsce reguły biznesowej „przeleci w promieniu za 2–15 min”, liczone po prostej przy bieżącym
kursie i prędkości.

**Contract**:

- Stałe: `LEAD_MIN_S = 120`, `LEAD_MAX_S = 900`, `MAX_POSITION_AGE_S = 60`, `LOOKAHEAD_SPEED_KT = 600`.
- `queryRadiusKm(radiusKm: number): number` = promień użytkownika + droga przy `LOOKAHEAD_SPEED_KT` w `LEAD_MAX_S`
  (~277,8 km). Limit 250 nm stosuje klient ADS-B.
- `predictPass(aircraft: AircraftState, home: { lat: number; lon: number }, radiusKm: number): PassPrediction | null`,
  gdzie `PassPrediction = { secondsToClosest: number; closestDistanceKm: number; alreadyClose: boolean; approachFrom: CompassPoint }`
  i `CompassPoint` to jeden z 8 kierunków (`"N" | "NE" | … | "NW"`).
- Zwraca `null`, gdy: `onGround`; brak `trackDeg` lub `groundSpeedKt`; `positionAgeS > MAX_POSITION_AGE_S`
  (`null` wiek traktowany jak 0).
- Obliczenia w lokalnym płaskim układzie wokół domu (x = Δlon·cos(lat domu)·R, y = Δlat·R). Pozycja przesunięta
  o `positionAgeS` po bieżącym kursie. Czas najbliższego punktu `t = max(0, −(p·v)/|v|²)`; przy `|v| = 0` `t = 0`.
  Gdy najbliższy punkt już minął, `t = 0`, a odległość to odległość bieżąca.
- Alert (wynik nie-`null`) wtedy i tylko wtedy, gdy `closestDistanceKm ≤ radiusKm` i `secondsToClosest ≤ LEAD_MAX_S`.
  `alreadyClose = secondsToClosest < LEAD_MIN_S` (dokładnie 120 s to jeszcze zwykły alert).
- `approachFrom` to kierunek z domu do bieżącej (przesuniętej o wiek) pozycji samolotu, zaokrąglony do 8 punktów.

#### 3. Reguła duplikatu

**File**: `src/lib/alerts.ts` (nowy, bez importów serwerowych)

**Intent**: FR-010 w jednym miejscu: ta sama maszyna to ten sam adres transpondera albo ta sama rejestracja,
niezależnie od znaku wywoławczego.

**Contract**: `DEDUP_WINDOW_MS = 60 * 60_000` oraz
`isRecentlyAlerted(aircraft: { hex: string; registration: string | null }, recent: readonly { aircraft_hex: string; registration: string | null; sent_at: string }[], now: Date): boolean`.
Duplikat, gdy istnieje wpis z `now − sent_at < DEDUP_WINDOW_MS` i (ten sam `hex`, który nie zaczyna się od `~`,
albo ta sama niepusta rejestracja). Wpis sprzed dokładnie 60 min nie blokuje.

#### 4. Treść wiadomości

**File**: `src/lib/alerts.ts`

**Intent**: Treść z FR-009 jako zwykły tekst (bez `parse_mode`, więc bez escapowania), po angielsku jak reszta UI.

**Contract**: `ALERT_TIME_ZONE = "Europe/Warsaw"` oraz
`formatAlertMessage(aircraft: AircraftState, prediction: PassPrediction, now: Date): string`. Linie:
typ i rejestracja (`registration unknown`, gdy brak); przy zwykłym alercie „overhead in ~N min (HH:MM)”, gdzie
N = `Math.round(secondsToClosest / 60)`, a HH:MM to `now + secondsToClosest` w `ALERT_TIME_ZONE`; przy
`alreadyClose` oznaczenie „ALREADY CLOSE” zamiast czasu wyprzedzenia; kierunek „approaching from <approachFrom>”
i odległość najbliższego punktu w km (1 miejsce po przecinku); „Route unknown”; link źródła
`https://globe.adsb.fi/?icao=<hex>` z dopiskiem „Data: adsb.fi” (obowiązek atrybucji). Typ samolotu bez kodu
(`null`) nie trafia tu nigdy, bo poller dopasowuje po typie.

#### 5. Testy

**File**: `src/lib/flyover.test.ts`, `src/lib/alerts.test.ts` (nowe)

**Intent**: Zablokować przypadki brzegowe reguły, które łatwo zepsuć po cichu.

**Contract**: `flyover.test.ts` co najmniej: samolot lecący prosto na dom z 10 min do przelotu → alert, nie „already
close”; odległość najbliższego punktu dokładnie równa promieniowi → alert; tuż ponad promieniem → `null`;
`secondsToClosest` 900 → alert, 901 → `null`; 120 s → zwykły, 119 s → „already close”; samolot w promieniu
oddalający się → „already close” z `secondsToClosest = 0`; oddalający się poza promieniem → `null`; na ziemi,
bez kursu, bez prędkości, wiek pozycji 61 s → `null`; wiek pozycji przesuwa pozycję (ten sam samolot z wiekiem
30 s ma `secondsToClosest` mniejszy o ~30 s); prędkość 0 w promieniu → „already close”; `approachFrom` dla
samolotu na północny zachód od domu → `NW`; `queryRadiusKm(30)` ≈ 307,8. `alerts.test.ts`: duplikat po `hex`, po
rejestracji przy innym `hex`, brak duplikatu dla `~hex` bez rejestracji, wpis sprzed 59 min blokuje, sprzed 60 min
nie; wiadomość zawiera typ, rejestrację lub „registration unknown”, „~7 min”, godzinę w Europe/Warsaw dla stałego
`now`, „ALREADY CLOSE” zamiast czasu wyprzedzenia, „Route unknown” i link `globe.adsb.fi` z `hex`.

#### 6. Dokumentacja runnera

**File**: `CLAUDE.md` (sekcje `## Commands` i zdanie o braku runnera)

**Intent**: Następny agent wie, że runner istnieje i czego dotyczy.

**Contract**: komenda `npm test` (Vitest, tylko czyste moduły `src/lib/**/*.test.ts`, bez workerd) i zastąpienie
zdania „No unit test runner is configured” opisem trzech rodzajów testów (`npm test`, `smoke`, `test:db`).

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Lint, typecheck i build czyste: `npm run lint && npx astro sync && npx astro check && npm run build`
- Krok testów jest w CI: `grep -q "npm test" .github/workflows/ci.yml`

#### Manual Verification:

- Przegląd `src/lib/flyover.ts`: granice (≤ promień, ≤ 900 s, < 120 s) zgadzają się z Business Logic PRD i decyzjami planu

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 2.

---

## Faza 2: Kanał Telegram w ustawieniach

### Overview

Użytkownik zapisuje swój chat ID na `/settings` i wysyła wiadomość testową. Klient Telegrama jest gotowy dla
pollera.

### Changes Required:

#### 1. Migracja chat ID

**File**: `supabase/migrations/<timestamp>_alert_settings_telegram.sql` (przez `npx supabase migration new alert_settings_telegram`)

**Intent**: Kanał powiadomień per użytkownik, pod istniejącym RLS.

**Contract**: `alter table public.alert_settings add column telegram_chat_id bigint;` (nullable, bez domyślnej).
Komentarz po polsku: kolumna dziedziczy table-level `grant update` i polityki „own settings”. Bez zmian w grantach
i politykach.

#### 2. Test pgTAP

**File**: `supabase/tests/alert_settings_rls.sql`

**Intent**: Dowód, że użytkownik zapisuje własny chat ID, a cudzego nie widzi.

**Contract**: nowe asercje (z `plan(12)` na odpowiednio większe): zalogowany ustawia `telegram_chat_id` we własnym
wierszu; drugi użytkownik nie widzi tej wartości (`select` zwraca 0 wierszy cudzych ustawień).

#### 3. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Typowany dostęp do nowej kolumny.

**Contract**: `npx supabase migration up`, potem `npm run db:types`, bez ręcznej edycji.

#### 4. Sekret i typy Workers

**File**: `astro.config.mjs`, `.env.example`, `worker-configuration.d.ts` (generowany)

**Intent**: Token bota czytany wyłącznie przez `astro:env/server`.

**Contract**: `TELEGRAM_BOT_TOKEN: envField.string({ context: "server", access: "secret", optional: true })`;
`.env.example` dostaje `TELEGRAM_BOT_TOKEN=###`. Po dopisaniu do `.dev.vars` `npm run cf:types`; sprawdzić, że plik
zawiera tylko nazwę, nie wartość.

#### 5. Klient Telegrama

**File**: `src/lib/telegram.ts` (nowy)

**Intent**: Jedyne miejsce znające Bot API; nigdy nie rzuca, jak klient ADS-B.

**Contract**:
`sendTelegramMessage(input: { token: string; chatId: number; text: string }): Promise<{ ok: true } | { ok: false; httpStatus: number | null; error: string }>`.
`POST https://api.telegram.org/bot<token>/sendMessage`, JSON `{ chat_id, text, link_preview_options: { is_disabled: true } }`,
timeout 10 s. Błąd z pola `description` odpowiedzi Telegrama (np. „Bad Request: chat not found”, „Forbidden: bot was
blocked by the user”) albo opis błędu sieci/timeoutu. Komunikat nigdy nie zawiera URL-a ani tokena.

#### 6. Pole chat ID w ustawieniach

**File**: `src/lib/alert-settings.ts`, `src/pages/api/settings.ts`, `src/pages/settings.astro`, `src/components/settings/AlertSettingsForm.tsx`

**Intent**: Chat ID zapisywany i walidowany tą samą ścieżką co reszta ustawień.

**Contract**: `AlertSettingsInput.telegram_chat_id: number | null`. Pole formularza `telegram_chat_id`: puste →
`null`; inaczej musi pasować do `^-?\d{1,15}$` (mieści się w bezpiecznej liczbie całkowitej, obejmuje ujemne ID
grup), błąd „Telegram chat ID must be a whole number, e.g. 123456789”. Endpoint zapisuje pole razem z resztą.
Strona czyta kolumnę i przekazuje ją w `initial`. Wyspa: pole tekstowe z `inputMode="numeric"` i podpowiedzią
„Open your bot in Telegram and press Start, then get your chat ID from @userinfobot”.

#### 7. Wiadomość testowa

**File**: `src/pages/api/settings/telegram-test.ts` (nowy), `src/pages/settings.astro`

**Intent**: Sprawdzenie kanału bez czekania na samolot.

**Contract**: `export const POST: APIRoute`. Brak `locals.user` → redirect `/auth/signin`; `createClient()` `null`
→ `/settings?error=Supabase is not configured`; brak `TELEGRAM_BOT_TOKEN` → `/settings?error=` z komunikatem, że bot
nie jest skonfigurowany; zapisany `telegram_chat_id` (odczyt pod RLS) pusty → `/settings?error=` „Save your Telegram
chat ID first”; błąd wysyłki → `/settings?error=Telegram: <error>`; sukces → `/settings?telegram=sent`. Treść
„Nad Głową test message: aircraft alerts will arrive in this chat.” Na stronie osobny formularz (nie zagnieżdżony)
z przyciskiem „Send test message” pod formularzem ustawień, z dopiskiem, że test używa zapisanego chat ID;
`?telegram=sent` pokazuje potwierdzenie.

#### 8. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Round-trip chat ID i zachowanie endpointu testowego bez zależności od Telegrama.

**Contract**: `settingsForm` dostaje `telegram_chat_id: "123456789"`, a krok „settings page shows saved values”
oczekuje też `123456789`. Nowe kroki: zapis z `telegram_chat_id=abc` → `302` → `/settings?error=`; zalogowany
`POST /api/settings/telegram-test` → `302` → `/settings?error=` (w CI brak tokena, lokalnie Telegram odrzuca
nieistniejący czat); anonimowy `POST /api/settings/telegram-test` (po signout) → `302` → `/auth/signin`.

#### 9. Instrukcja bota

**File**: `README.md`

**Intent**: Od zera do działającego kanału.

**Contract**: w sekcji konfiguracji: bot przez @BotFather, `TELEGRAM_BOT_TOKEN` w `.dev.vars`, Start w rozmowie
z botem, chat ID z @userinfobot, wklejenie na `/settings`, przycisk testowy.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się bez resetu danych: `npx supabase migration up`
- Testy bazy przechodzą z nowymi asercjami: `npm run test:db`
- Typy zawierają kolumnę: `npm run db:types && grep -q telegram_chat_id src/db/database.types.ts`
- Lint, testy, typecheck i build czyste: `npm run lint && npm test && npx astro sync && npx astro check && npm run build`
- Smoke przechodzi z nowymi krokami: `npm run dev`, potem `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- `worker-configuration.d.ts` zawiera nazwę `TELEGRAM_BOT_TOKEN`, bez wartości
- Po zapisaniu prawdziwego chat ID przycisk „Send test message” dostarcza wiadomość na Telegram i pokazuje potwierdzenie
- Błędny chat ID (np. `123`) daje czytelny błąd Telegrama na `/settings`, bez tokena w treści

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 3.

---

## Faza 3: Poller z dziennikiem i deduplikacją

### Overview

Tabela wysłanych alertów i poller wpięty w `runWork()`: pobranie, predykcja, deduplikacja, wysyłka, zapis.

### Changes Required:

#### 1. Migracja dziennika alertów

**File**: `supabase/migrations/<timestamp>_alert_notifications.sql` (przez `npx supabase migration new alert_notifications`)

**Intent**: Pamięć deduplikacji i dowód kryterium „≥ 2 min przed”; dostępna wyłącznie dla `service_role`.

**Contract**: `public.alert_notifications`: `id bigint generated always as identity primary key`,
`user_id uuid not null references auth.users(id) on delete cascade`, `aircraft_hex text not null`,
`registration text`, `aircraft_type text not null`, `sent_at timestamptz not null default now()`,
`closest_at timestamptz not null`, `closest_distance_km numeric(6,1) not null check (closest_distance_km >= 0)`,
`already_close boolean not null`. Indeks `(user_id, sent_at desc)`. `revoke all` z `anon` i `authenticated`, RLS
włączone, zero polityk. Komentarze po polsku: brak współrzędnych domu i samolotu w tabeli; polityka `select` dla
własnych wierszy przyjdzie z FR-011.

#### 2. Test pgTAP

**File**: `supabase/tests/alert_notifications_rls.sql` (nowy)

**Intent**: Zablokować przypadkowe otwarcie tabeli dla zalogowanych.

**Contract**: wzorem `cron_runs_rls.sql`: tabela istnieje, RLS włączone, zero polityk, `authenticated` nie może
`select` ani `insert`, `anon` nie może `select`, ograniczenie `closest_distance_km >= 0` działa (kod `23514`).

#### 3. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Typowany dostęp do `alert_notifications`.

**Contract**: `npx supabase migration up`, potem `npm run db:types`.

#### 4. Poller

**File**: `src/workers/alert-poller.ts` (nowy)

**Intent**: Jeden bieg alertów dla wszystkich aktywnych użytkowników; klienta `service_role` dostaje w parametrze,
więc granica ESLint zostaje nietknięta.

**Contract**:
`runAlertPoll(supabase: SupabaseClient<Database>, now: () => Date): Promise<AlertPollSummary>`, gdzie
`AlertPollSummary = { users: number; polled: number; matches: number; duplicates: number; sent: number; errors: string[] }`.
Przebieg:

1. Brak `TELEGRAM_BOT_TOKEN` (odczyt w funkcji z `astro:env/server`) → błąd w `errors`, bez pobierania ADS-B.
2. Ustawienia: `paused = false`, `home_lat`/`home_lon` i `telegram_chat_id` niepuste; użytkownicy z pustą listą
   typów są pomijani w kodzie.
3. Użytkownicy po kolei, z odstępem ≥ 1100 ms między zapytaniami ADS-B. `fetchAircraftNear` z
   `queryRadiusKm(radius_km)`. Błąd pobrania → wpis w `errors`; odpowiedź 4xx przerywa pobieranie dla pozostałych
   użytkowników w tym biegu (ochrona przed blokadą IP).
4. Kandydaci: typ z listy użytkownika i `predictPass` nie-`null`. Tylko gdy są kandydaci: jedno zapytanie o wpisy
   użytkownika z ostatnich `DEDUP_WINDOW_MS`.
5. Dla każdego kandydata: `isRecentlyAlerted` → licznik `duplicates`; inaczej `sendTelegramMessage` z
   `formatAlertMessage`; sukces → insert wiersza (`closest_at = now + secondsToClosest`) i dopisanie go do listy
   ostatnich w pamięci (dwa wpisy tej samej maszyny w jednej odpowiedzi dają jeden alert); błąd wysyłki lub zapisu
   → wpis w `errors`.
6. Komunikaty w `errors` w formacie `user <n>: <przyczyna>`, bez współrzędnych, chat ID i tokena.

#### 5. Wpięcie w handler

**File**: `src/workers/scheduled.ts`

**Intent**: Bieg crona wykonuje poller, a wynik trafia do `cron_runs` i logu.

**Contract**: `runWork` przyjmuje klienta i zwraca `AlertPollSummary` z `runAlertPoll(supabase, () => new Date())`.
Niepuste `errors` → `status: "error"`, `error` = połączone błędy przycięte do 500 znaków. Wyjątek nadal łapany jak
dziś. Linia logu dopisuje liczniki (`users`, `polled`, `matches`, `duplicates`, `sent`). Kontrakt „nigdy nie rzuca”
bez zmian.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się bez resetu danych: `npx supabase migration up`
- Testy bazy przechodzą z nowym plikiem: `npm run test:db`
- Lint, testy, typecheck i build czyste: `npm run db:types && npm run lint && npm test && npx astro sync && npx astro check && npm run build`
- Przy działającym `npm run dev` wywołanie `curl -s -o /dev/null -w "%{http_code}" "http://localhost:4321/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"` zwraca 200, a log dev pokazuje liczniki biegu
- `npm run smoke` przechodzi na działającym `npm run dev`

#### Manual Verification:

- Bez `TELEGRAM_BOT_TOKEN` bieg kończy się `error` z czytelnym komunikatem, a dashboard pokazuje „(last run failed)”
- Z typem popularnym nad okolicą (np. `A20N`, `B738`) w ciągu kilku biegów przychodzi alert na Telegram z typem, rejestracją, czasem, kierunkiem i „Route unknown”
- Ta sama maszyna nie daje drugiego alertu w kolejnych biegach (log pokazuje rosnące `duplicates`)
- Po ustawieniu `paused = true` w Studio alerty przestają przychodzić, a biegi nadal się zapisują

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 4.

---

## Faza 4: Walidacja na żywo i dokumentacja

### Overview

Dowód głównego kryterium sukcesu na prawdziwych przelotach i zapis decyzji w dokumentach foundation.

### Changes Required:

#### 1. Walidacja kryterium sukcesu

**File**: brak (lokalna baza i Telegram)

**Intent**: Potwierdzić, że alerty przychodzą co najmniej 2 min przed najbliższym punktem.

**Contract**: co najmniej godzina biegu z popularnym typem nad okolicą. Zapytanie w Studio:
`select count(*) from alert_notifications where not already_close and closest_at - sent_at < interval '2 minutes'`
→ 0. Dla co najmniej jednego alertu porównanie `closest_at` z rzeczywistym przelotem na historii
`globe.adsb.fi` (link z wiadomości). Godzina w wiadomości zgadza się z zegarem lokalnym (strefa w workerd).

#### 2. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Roadmapa odzwierciedla wchłonięcie S-04 i rozstrzygnięte pytania.

**Contract**: Open Roadmap Question 4 z odpowiedzią „60 min od wysłania alertu (2026-10-05)”; S-04: Unknown
o długości okna z odpowiedzią, `Block: no`, status `planning`, dopisek „realizowane w zmianie
`first-advance-alert`” (także w wierszu `## At a glance` i `## Backlog Handoff`); S-05 Risk z dopiskiem, że poller
już respektuje `paused`; Open Roadmap Question 8 z adnotacją, że wysłane alerty są zapisywane w
`alert_notifications` bez retencji.

#### 3. Stan wdrożenia

**File**: `context/deployment/deploy-plan.md`

**Intent**: Następny deploy nie złamie `/settings`.

**Contract**: notatka, że przed kolejnym `wrangler deploy` trzeba wypchnąć migracje `alert_settings_telegram`
i `alert_notifications` (`npx supabase db push`), bo `/settings` czyta `telegram_chat_id`; `TELEGRAM_BOT_TOKEN`
istnieje tylko w `.dev.vars`.

### Success Criteria:

#### Automated Verification:

- Lint i testy czyste po zmianach dokumentów: `npm run lint && npm test`
- Roadmapa zawiera odpowiedź na pytanie 4: `grep -q "60 min" context/foundation/roadmap.md`

#### Manual Verification:

- Zapytanie o alerty wysłane później niż 2 min przed najbliższym punktem (bez „already close”) zwraca 0
- Co najmniej jeden alert porównany z rzeczywistym przelotem na `globe.adsb.fi` mieści się w kryterium
- Godzina w wiadomości zgadza się z zegarem lokalnym
- Roadmapa i `deploy-plan.md` opisują stan po zmianie

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu.

---

## Testing Strategy

### Unit Tests:

- Vitest: `src/lib/flyover.test.ts` (granice promienia i okna, „already close”, oddalanie się, odrzucenia, wiek
  pozycji, kierunek, promień zapytania) i `src/lib/alerts.test.ts` (deduplikacja po `hex`/rejestracji, `~hex`,
  granica 60 min, treść wiadomości ze stałym `now`).

### Integration Tests:

- pgTAP: `alert_settings_rls.sql` (chat ID pod RLS), `alert_notifications_rls.sql` (tylko `service_role`).
- Smoke: round-trip chat ID, walidacja, endpoint testowy z redirectem błędu, anonimowe redirecty.
- Wyzwolenie `scheduled` przez `/cdn-cgi/handler/scheduled` z licznikami w logu.

### Manual Testing Steps:

1. `npx supabase start`, `TELEGRAM_BOT_TOKEN` w `.dev.vars`, `npm run dev`, w drugim terminalu `npm run cron:local`.
2. Na `/settings` zapisz dom, promień 30, typ popularny nad okolicą i chat ID; „Send test message”.
3. Czekaj na alert; sprawdź treść i link.
4. Obserwuj kolejne biegi: brak powtórki tej samej maszyny, rosnące `duplicates`.
5. `paused = true` w Studio: brak alertów, biegi trwają.
6. Po godzinie zapytanie o kryterium 2 min i porównanie z `globe.adsb.fi`.

## Performance Considerations

Promień zapytania ~310 km zwraca więcej samolotów niż pomiar F-01 (100 km, ~32), ale to nadal jedna odpowiedź JSON
na użytkownika na minutę. Predykcja to arytmetyka na kilkuset wpisach. Zapytanie deduplikacji idzie tylko przy
kandydatach i po indeksie `(user_id, sent_at desc)`. Przy N użytkownikach bieg trwa co najmniej ~1,1·N s przez limit
adsb.fi; przy małej skali mieści się w minucie.

## Migration Notes

Obie migracje są addytywne. Lokalnie `npx supabase migration up`, nie `db reset`, żeby nie stracić kont i ustawień.
Produkcja nie dostaje migracji w tej zmianie; kod na produkcji pozostaje w wersji sprzed zmiany, a następny deploy
wymaga wcześniejszego `db push` (Faza 4, `deploy-plan.md`).

## References

- Roadmapa: `context/foundation/roadmap.md` (S-03, S-04, Open Roadmap Questions 3, 4, 8, 10)
- PRD: `context/foundation/prd.md` (US-01, FR-009, FR-010, Business Logic, NFR < 60 s)
- Źródło ADS-B: `context/foundation/adsb-source.md` („Wskazówki dla S-03”, „Limity i warunki”)
- Brak SMTP / Telegram: `context/foundation/infrastructure.md:71`
- Handler crona: `src/workers/scheduled.ts`; klient ADS-B: `src/lib/adsb.ts`
- Wzorce: `src/pages/api/settings.ts`, `src/components/settings/AlertSettingsForm.tsx`,
  `supabase/migrations/20260928180224_cron_runs.sql`, `supabase/tests/cron_runs_rls.sql`, `scripts/smoke.mjs`
- Poprzednie plany: `context/archive/2026-09-28-minute-cron-heartbeat/plan.md`,
  `context/archive/2026-09-28-alert-settings-basic/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Predykcja, deduplikacja i treść alertu

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `npm test` — 2cb56ef
- [x] 1.2 Lint, typecheck i build czyste — 2cb56ef
- [x] 1.3 Krok testów jest w CI — 2cb56ef

#### Manual

- [x] 1.4 Przegląd granic w `src/lib/flyover.ts` względem Business Logic PRD i decyzji planu — 2cb56ef

### Phase 2: Kanał Telegram w ustawieniach

#### Automated

- [x] 2.1 Migracja stosuje się bez resetu danych — fe8c3aa
- [x] 2.2 Testy bazy przechodzą z nowymi asercjami — fe8c3aa
- [x] 2.3 Typy zawierają kolumnę `telegram_chat_id` — fe8c3aa
- [x] 2.4 Lint, testy, typecheck i build czyste — fe8c3aa
- [x] 2.5 Smoke przechodzi z nowymi krokami — fe8c3aa

#### Manual

- [ ] 2.6 `worker-configuration.d.ts` zawiera nazwę `TELEGRAM_BOT_TOKEN`, bez wartości
- [ ] 2.7 Przycisk „Send test message” dostarcza wiadomość i pokazuje potwierdzenie
- [ ] 2.8 Błędny chat ID daje czytelny błąd bez tokena w treści

### Phase 3: Poller z dziennikiem i deduplikacją

#### Automated

- [x] 3.1 Migracja stosuje się bez resetu danych
- [x] 3.2 Testy bazy przechodzą z nowym plikiem
- [x] 3.3 Typy, lint, testy, typecheck i build czyste
- [x] 3.4 Wyzwolenie `scheduled` zwraca 200, a log pokazuje liczniki biegu
- [x] 3.5 Smoke przechodzi na `npm run dev`

#### Manual

- [x] 3.6 Bez `TELEGRAM_BOT_TOKEN` bieg kończy się `error`, a dashboard pokazuje „(last run failed)”
- [ ] 3.7 Alert o popularnym typie przychodzi na Telegram z pełną treścią
- [ ] 3.8 Ta sama maszyna nie daje drugiego alertu w kolejnych biegach
- [ ] 3.9 `paused = true` wstrzymuje alerty, biegi trwają

### Phase 4: Walidacja na żywo i dokumentacja

#### Automated

- [ ] 4.1 Lint i testy czyste po zmianach dokumentów
- [ ] 4.2 Roadmapa zawiera odpowiedź na pytanie 4

#### Manual

- [ ] 4.3 Zapytanie o alerty później niż 2 min przed najbliższym punktem zwraca 0
- [ ] 4.4 Alert porównany z rzeczywistym przelotem na `globe.adsb.fi` mieści się w kryterium
- [ ] 4.5 Godzina w wiadomości zgadza się z zegarem lokalnym
- [ ] 4.6 Roadmapa i `deploy-plan.md` opisują stan po zmianie
