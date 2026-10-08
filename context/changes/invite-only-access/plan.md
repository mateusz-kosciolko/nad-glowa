# Dostęp tylko dla zaproszonych (S-01) — plan implementacji

## Overview

S-01 z roadmapy (`invite-only-access`). Aplikacja zostaje domyślnie zamknięta: niezalogowany widzi tylko ekran
logowania, a każda inna trasa przekierowuje do `/auth/signin`. Samodzielna rejestracja znika z kodu i z Supabase;
konta zakłada się ręcznie w panelu Supabase (PRD, Access Control). Smoke, który dziś zakłada konto przez
rejestrację, dostaje nową ścieżkę: tworzy konto przez Admin API lokalnej Supabase i usuwa je po biegu. Na końcu
rejestracja zostaje zamknięta także na produkcji.

## Current State Analysis

- Middleware chroni listę prefiksów (`src/middleware.ts:4`: `/dashboard`, `/settings`, `/api/settings`, `/api/adsb`);
  wszystko inne jest publiczne.
- `/` renderuje landing startera (`src/pages/index.astro` → `src/components/Welcome.astro`) z przyciskami „Sign Up”
  (`Welcome.astro:36`) i `Topbar` z linkiem „Sign up” (`Topbar.astro:27`). `Topbar` jest używany tylko w `Welcome`.
- Rejestracja: `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/pages/api/auth/signup.ts`,
  `src/components/auth/SignUpForm.tsx`; link „Sign up” na `src/pages/auth/signin.astro`.
- Logowanie po sukcesie przekierowuje na `/` (`src/pages/api/auth/signin.ts:19`).
- `supabase/config.toml`: `enable_signup = true` w `[auth]` (:169) i `[auth.email]` (:204), `enable_confirmations = false`.
- Smoke (`scripts/smoke.mjs`) zakłada `smoke-<ts>@example.com` przez `/api/auth/signup` (:53); od tego zależą
  wszystkie kroki po zalogowaniu. Krok „home renders” oczekuje 200 na `/` dla anonima (:47). Konta smoke nigdy nie
  są usuwane (lokalna baza ma ich już ~20).
- CI (`.github/workflows/ci.yml:43`) eksportuje z `supabase status -o env` tylko `API_URL` i `ANON_KEY`.
- Trigger `handle_new_user` tworzy wiersz `alert_settings` dla każdego nowego konta, także z panelu; pgTAP już go
  testuje (`supabase/tests/alert_settings_rls.sql:21-33`).
- Handler `scheduled` to osobny eksport w `src/worker.ts`, poza middleware — zamknięcie tras go nie dotyczy.
- Produkcja: 2026-09-23 `/auth/signup` zwracało 200 (`deploy-plan.md`), więc rejestracja jest tam otwarta. Przed
  następnym `wrangler deploy` trzeba wypchnąć zaległe addytywne migracje (`cron_runs` ×2 i `first-advance-alert` ×2),
  bo obecny kod czyta `telegram_chat_id` i `cron_runs` (`deploy-plan.md`).

## Desired End State

Anonim na dowolnej trasie poza `/auth/signin` (i endpointami logowania/wylogowania) dostaje 302 na `/auth/signin`.
Zalogowany wchodzący na `/` trafia na `/dashboard`. W aplikacji nie ma strony, endpointu ani linku rejestracji,
a Supabase lokalnie i na produkcji odrzuca `signUp`. `npm run smoke` zakłada konto testowe przez Admin API
lokalnej Supabase, przechodzi pełny przepływ po zalogowaniu, sprawdza, że rejestracja jest zamknięta na obu
warstwach, i usuwa konto. CI przechodzi z nowym smoke. Produkcja działa na nowym kodzie po migracjach.

### Key Discoveries:

- Node 22 obsługuje `--env-file-if-exists`, więc smoke czyta lokalnie `.dev.vars` bez zależności.
- `supabase status -o env` zwraca `SERVICE_ROLE_KEY`; GoTrue Admin API (`/auth/v1/admin/users`) przyjmuje go jako
  `apikey` i `Authorization: Bearer`.
- Usunięcie konta przez Admin API kasuje kaskadowo `alert_settings` i `alert_notifications` (FK `on delete cascade`).
- Hard rule z `CLAUDE.md` i ESLint dotyczą `src/`; `scripts/smoke.mjs` jest poza nimi, ale reguła musi wprost
  nazwać ten wyjątek, żeby kolejny agent nie uznał go za naruszenie.

## What We're NOT Doing

- Zaproszeń w aplikacji, panelu administratora ani skryptu zakładania kont — konta tylko ręcznie w panelu Supabase.
- Zmiany metody logowania (zostaje e-mail + hasło, Open Roadmap Question 5).
- Resetu hasła i zmiany hasła przez użytkownika.
- Przekierowania zalogowanego z `/auth/signin` na dashboard.
- Własnej strony 404: zalogowany na nieznanej trasie dostaje domyślną odpowiedź Astro.
- Wdrożenia crona ani `TELEGRAM_BOT_TOKEN` na produkcję (`## Parked` w roadmapie).
- Przebudowy wyglądu ekranu logowania (to zadanie dla `/10x-ui`).

## Implementation Approach

Jedna lokalna faza, bo zamknięcie tras, usunięcie rejestracji i nowy smoke muszą wejść razem — każda połowa
osobno łamie smoke albo CI. Druga faza grupuje wszystkie kroki na produkcji, w tym ten, który robi człowiek
(przełącznik w panelu Supabase).

## Critical Implementation Details

- **Konfiguracja lokalnej Supabase** — zmiana `enable_signup` w `config.toml` działa dopiero po
  `npx supabase stop && npx supabase start`; bez restartu lokalny GoTrue dalej przyjmuje `signUp` i nowy krok smoke
  nie przejdzie. Restart nie kasuje danych (bez `--no-backup`).
- **Blokada smoke** — skrypt dostaje klucz `service_role`, więc przed pierwszym żądaniem sprawdza, że host
  `SUPABASE_URL` to `127.0.0.1`, `localhost` albo `::1`, i w przeciwnym razie kończy się kodem 1 bez żadnego żądania.
  Sprzątanie konta działa także wtedy, gdy któryś krok padnie.
- **Kolejność na produkcji** — najpierw `db push` (addytywne migracje; stary Worker działa z nimi), potem
  przełącznik w panelu, potem deploy.

## Faza 1: Zamknięte trasy i koniec rejestracji

### Overview

Middleware zamyka wszystko poza logowaniem, rejestracja znika z kodu i lokalnej Supabase, smoke zakłada konto
przez Admin API, CI i dokumentacja nadążają.

### Changes Required:

#### 1. Middleware: domyślnie zamknięte

**File**: `src/middleware.ts`

**Intent**: Odwrócić model z listy chronionych prefiksów na listę publicznych tras, zgodnie z PRD („każda inna
trasa przekierowuje do logowania”).

**Contract**: `PROTECTED_ROUTES` zastąpione przez `PUBLIC_ROUTES = ["/auth/signin", "/api/auth/signin", "/api/auth/signout"]`
dopasowywane dokładnie po `pathname` (bez końcowego `/` — `/auth/signin/` traktować jak `/auth/signin`). Anonim
poza listą → `302 /auth/signin`. `context.locals.user` ustawiany jak dziś. Komentarz nad listą: trasa jest
prywatna, dopóki nie trafi na tę listę.

#### 2. Strona `/` i cel po zalogowaniu

**File**: `src/pages/index.astro`, `src/pages/api/auth/signin.ts`

**Intent**: `/` nie ma już własnej treści; zalogowany od razu ląduje w aplikacji.

**Contract**: `index.astro` zwraca `Astro.redirect("/dashboard")` (anonima przekierowuje wcześniej middleware).
`signin.ts` po sukcesie przekierowuje na `/dashboard` zamiast `/`.

#### 3. Usunięcie rejestracji i landingu

**File**: usunąć `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/pages/api/auth/signup.ts`,
`src/components/auth/SignUpForm.tsx`, `src/components/Welcome.astro`, `src/components/Topbar.astro`; edytować
`src/pages/auth/signin.astro`, `src/pages/settings.astro`

**Intent**: Brak martwego kodu i linków do nieistniejącej rejestracji.

**Contract**: `signin.astro` bez akapitu „Don't have an account? Sign up”; w jego miejscu krótka informacja, że
konta zakłada administrator (np. „Access is by invitation only.”). Komentarz w `settings.astro:32` mówi o koncie
„created in the Supabase dashboard” zamiast „signup trigger”. Po usunięciu `grep -rn "signup\|SignUp\|Welcome\|Topbar" src`
nie zwraca nic poza ewentualnymi niepowiązanymi trafieniami.

#### 4. Lokalna Supabase bez rejestracji

**File**: `supabase/config.toml`

**Intent**: Druga warstwa zamknięcia — nawet bezpośrednie wywołanie `signUp` kluczem `anon` jest odrzucane.

**Contract**: `enable_signup = false` w `[auth]` i w `[auth.email]`. Komentarz po polsku: konta tylko przez panel
lub Admin API (smoke).

#### 5. Smoke z kontem z Admin API

**File**: `scripts/smoke.mjs`, `package.json`

**Intent**: Zastąpić ścieżkę rejestracji (ryzyko z roadmapy S-01), zachowując pełny przepływ po zalogowaniu.

**Contract**:

- `package.json`: `"smoke": "node --env-file-if-exists=.dev.vars scripts/smoke.mjs"`.
- Wymagane zmienne: `SUPABASE_URL`, `SUPABASE_KEY` (anon), `SUPABASE_SERVICE_KEY`; brak którejkolwiek → komunikat
  i kod 1. Blokada hosta jak w „Critical Implementation Details”.
- Przed krokami: `POST {SUPABASE_URL}/auth/v1/admin/users` z `{ email, password, email_confirm: true }`; zapamiętane
  `id`. Po krokach (w `finally`): `DELETE /auth/v1/admin/users/{id}`; błąd sprzątania wypisany, ale nie zmienia
  wyniku testu.
- Kroki zmienione: „home renders” → „home redirects anonymous user” (`302 /auth/signin`); usunięty „signup creates
  account”; „signin accepts correct password” oczekuje `302 /dashboard`.
- Kroki nowe: anonimowy `GET /auth/signup` → `302 /auth/signin`; anonimowy `POST /api/auth/signup` → `302 /auth/signin`;
  anonimowy `GET /auth/signin` → `200` i treść bez „Sign up”; bezpośredni `POST {SUPABASE_URL}/auth/v1/signup`
  kluczem anon → status 4xx (Supabase odrzuca rejestrację); zalogowany `GET /` → `302 /dashboard`.
- Komentarz nagłówka: smoke działa tylko na lokalnej Supabase i usuwa swoje konto.

#### 6. CI z kluczem serwisowym lokalnej Supabase

**File**: `.github/workflows/ci.yml`

**Intent**: Smoke w CI ma klucz `service_role` lokalnej, efemerycznej Supabase.

**Contract**: grep eksportuje też `SERVICE_ROLE_KEY`; `.dev.vars` (i `.env`) dostaje `SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY`.
Smoke uruchamiany przez `npm run smoke`, więc czyta `.dev.vars`.

#### 7. Dokumentacja i reguła

**File**: `README.md`, `CLAUDE.md`

**Intent**: Następny agent i człowiek wiedzą, jak zakłada się konta i jak działa smoke.

**Contract**: README — tabela tras bez `/auth/signup` i `/auth/confirm-email`; zdanie o ochronie tras opisuje
`PUBLIC_ROUTES` (domyślnie zamknięte); sekcja „Email confirmation in local development” zastąpiona sekcją
o zakładaniu kont (panel Supabase → Authentication → Users → Add user, z „Auto Confirm User”; lokalnie Studio
`http://127.0.0.1:54323`); sekcja smoke: konto przez Admin API, wymaga `SUPABASE_SERVICE_KEY` lokalnej Supabase,
nigdy przeciw produkcji. `CLAUDE.md` — reguła „To require login…” zamieniona na: „Every route requires login
unless it is listed in `PUBLIC_ROUTES` in @src/middleware.ts”; w hard rule o `service_role` dopisany wyjątek:
`scripts/smoke.mjs` używa klucza lokalnej Supabase przez Admin API i odmawia działania na innym hoście; opis
`npm run smoke` w `## Commands` zaktualizowany (czyta `.dev.vars`, zakłada i usuwa konto).

### Success Criteria:

#### Automated Verification:

- Lint, testy, typecheck i build czyste: `npm run lint && npm test && npx astro sync && npx astro check && npm run build`
- Brak śladów rejestracji w `src`: `! grep -rnE "signup|SignUp|Welcome|Topbar" src`
- Lokalna Supabase po restarcie odrzuca rejestrację: `npx supabase stop && npx supabase start`, potem `curl` na `/auth/v1/signup` kluczem anon zwraca 4xx
- Smoke przechodzi na `npm run dev`: `npm run smoke`
- Testy bazy przechodzą: `npm run test:db`

#### Manual Verification:

- W przeglądarce bez sesji `/`, `/dashboard`, `/settings`, `/auth/signup` i losowa ścieżka kończą się na ekranie logowania, który ma style i nie pokazuje „Sign up”
- Po zalogowaniu `/` prowadzi na dashboard, a ustawienia i wylogowanie działają jak wcześniej
- Smoke z `SUPABASE_URL` ustawionym na nielokalny host kończy się błędem bez żadnego żądania
- Po biegu smoke w lokalnej bazie nie przybywa kont `smoke-*`

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu przed fazą 2.

---

## Faza 2: Produkcja

### Overview

Produkcja dostaje zaległe migracje, zamkniętą rejestrację w Supabase i nowy kod.

### Changes Required:

#### 1. Migracje na produkcji

**File**: brak (produkcyjna baza)

**Intent**: Nowy kod czyta `telegram_chat_id` i `cron_runs`; bez migracji `/settings` i `/dashboard` przestaną działać.

**Contract**: `npx supabase db push --dry-run` pokazuje dokładnie cztery migracje (`20260928180224_cron_runs`,
`20260929065324_cron_runs_hide_error`, `20261005113514_alert_settings_telegram`, `20261005132125_alert_notifications`),
potem `npx supabase db push`.

#### 2. Zamknięcie rejestracji w panelu (człowiek)

**File**: brak (panel Supabase, projekt `nwphfexokrngshgmhucf`)

**Intent**: Warstwa Supabase na produkcji, odpowiednik `enable_signup = false`.

**Contract**: Authentication → Sign In / Providers → „Allow new users to sign up” wyłączone. Robi to człowiek
(zmiana ustawień konta).

#### 3. Deploy i weryfikacja

**File**: brak

**Intent**: Produkcja na nowym kodzie.

**Contract**: `npm run build && npx wrangler deploy`. Weryfikacja przez `curl`: anonimowe `/`, `/dashboard`,
`/auth/signup` → `302 /auth/signin`; `/auth/signin` → `200`.

#### 4. Dokumenty

**File**: `context/deployment/deploy-plan.md`, `context/foundation/roadmap.md`

**Intent**: Zapis stanu produkcji i rozstrzygniętej niewiadomej S-01.

**Contract**: `deploy-plan.md` — wpis z datą: wersja Workera, wypchnięte cztery migracje, rejestracja zamknięta
w panelu; notatka o zaległych migracjach oznaczona jako nieaktualna. Roadmapa S-01 — niewiadoma o smoke
z odpowiedzią „konto przez Admin API lokalnej Supabase, usuwane po biegu (2026-10-08)”; Baseline/ryzyka
wspominające otwartą rejestrację zaktualizowane.

### Success Criteria:

#### Automated Verification:

- Dry-run pokazuje dokładnie cztery migracje: `npx supabase db push --dry-run`
- Migracje zastosowane: `npx supabase db push`
- Deploy udany: `npm run build && npx wrangler deploy`
- Produkcja: anonimowe `/`, `/dashboard`, `/auth/signup` zwracają `302` → `/auth/signin`, a `/auth/signin` zwraca `200`

#### Manual Verification:

- Człowiek wyłączył „Allow new users to sign up” w panelu Supabase
- Na produkcji istniejące konto loguje się, dashboard pokazuje stan crona, a `/settings` zapisuje ustawienia
- `deploy-plan.md` i roadmapa opisują stan po zmianie

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu.

---

## Testing Strategy

### Unit Tests:

- Brak nowych: zmiana nie dodaje czystej logiki w `src/lib`.

### Integration Tests:

- Smoke: anonimowe przekierowania (w tym `/`, `/auth/signup`, `POST /api/auth/signup`), odrzucenie `signUp` przez
  Supabase, pełny przepływ po zalogowaniu na koncie z Admin API, sprzątanie konta.
- pgTAP bez zmian: trigger `handle_new_user` i RLS ustawień.

### Manual Testing Steps:

1. `npx supabase stop && npx supabase start`, `npm run dev`.
2. W oknie prywatnym: `/`, `/dashboard`, `/settings`, `/auth/signup`, `/cokolwiek` → ekran logowania.
3. Zaloguj się kontem testowym → `/dashboard`; `/` → `/dashboard`; zapis ustawień; wylogowanie.
4. `SUPABASE_URL=https://example.com npm run smoke` → błąd bez żądań.
5. `npm run smoke` dwa razy; liczba kont `smoke-*` w Studio się nie zmienia.

## Migration Notes

Brak nowych migracji. Faza 2 wypycha cztery istniejące, addytywne migracje; obecny Worker działa z nimi, więc
kolejność „push → deploy” nie ma okna niespójności. Stare konta `smoke-*` w lokalnej bazie można usunąć ręcznie
w Studio; nie są częścią tej zmiany.

## References

- PRD: `context/foundation/prd.md` (FR-001, Access Control `:119`)
- Roadmapa: `context/foundation/roadmap.md` (S-01, Open Roadmap Question 5)
- Stan produkcji: `context/deployment/deploy-plan.md`
- Wzorce: `src/middleware.ts`, `scripts/smoke.mjs`, `.github/workflows/ci.yml`, `supabase/tests/alert_settings_rls.sql`
- Poprzednie plany: `context/archive/2026-09-28-alert-settings-basic/plan.md` (smoke i trigger),
  `context/archive/2026-10-05-first-advance-alert/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Zamknięte trasy i koniec rejestracji

#### Automated

- [x] 1.1 Lint, testy, typecheck i build czyste — ebf2a2c
- [x] 1.2 Brak śladów rejestracji w `src` — ebf2a2c
- [x] 1.3 Lokalna Supabase po restarcie odrzuca rejestrację — ebf2a2c
- [x] 1.4 Smoke przechodzi na `npm run dev` — ebf2a2c
- [x] 1.5 Testy bazy przechodzą — ebf2a2c

#### Manual

- [x] 1.6 Bez sesji każda trasa kończy się na ekranie logowania ze stylami i bez „Sign up” — ebf2a2c
- [x] 1.7 Po zalogowaniu `/` prowadzi na dashboard, ustawienia i wylogowanie działają — ebf2a2c
- [x] 1.8 Smoke z nielokalnym `SUPABASE_URL` kończy się błędem bez żądań — ebf2a2c
- [x] 1.9 Po biegu smoke nie przybywa kont `smoke-*` — ebf2a2c

### Phase 2: Produkcja

#### Automated

- [x] 2.1 Dry-run pokazuje dokładnie cztery migracje — bc60816
- [x] 2.2 Migracje zastosowane — bc60816
- [x] 2.3 Deploy udany — bc60816
- [x] 2.4 Produkcja: anonimowe trasy przekierowują do logowania, `/auth/signin` zwraca 200 — bc60816

#### Manual

- [x] 2.5 Człowiek wyłączył rejestrację w panelu Supabase — bc60816
- [x] 2.6 Na produkcji logowanie, dashboard i zapis ustawień działają — bc60816
- [x] 2.7 `deploy-plan.md` i roadmapa opisują stan po zmianie — bc60816
