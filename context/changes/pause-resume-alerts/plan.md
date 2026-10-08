# Wstrzymanie i wznowienie alertów (S-05) — plan implementacji

## Overview

S-05 z roadmapy (`pause-resume-alerts`), FR-006. Użytkownik może wstrzymać alerty (np. na urlop lub noc) i je
wznowić; w czasie pauzy nie dostaje powiadomień, a ustawienia pozostają nietknięte. Backend już respektuje pauzę —
brakuje przełącznika i widocznego stanu. Pauza trwa do ręcznego wznowienia i jest obsługiwana z dashboardu.

## Current State Analysis

- `alert_settings.paused boolean not null default false` istnieje od migracji
  `supabase/migrations/20260928084032_alert_settings.sql:14`; zalogowany ma `grant update` na całej tabeli i politykę
  „own settings updatable”, więc może zmienić `paused` we własnym wierszu bez nowej migracji.
- Poller pomija wstrzymanych (`src/workers/alert-poller.ts:52`, `.eq("paused", false)`), a zadanie cykliczne biegnie
  dalej — ryzyko z roadmapy (usypianie bazy po 7 dniach) jest już zaadresowane.
- Nikt w UI nie czyta ani nie zapisuje `paused`. `parseAlertSettingsForm` (`src/lib/alert-settings.ts`) nie zna tego
  pola, a `POST /api/settings` robi `update({ ...parsed.value })`, więc zapis ustawień nie nadpisuje pauzy.
- Wzorzec osobnego formularza i endpointu: `src/pages/api/settings/telegram-test.ts` (sprawdzenie `locals.user`,
  `createClient()` z obsługą `null`, odczyt/zapis pod RLS, redirect z parametrem błędu).
- Dashboard (`src/pages/dashboard.astro`) ma kartę stanu crona, która przy błędzie odczytu pokazuje komunikat zamiast
  psuć stronę; przyciski „Alert settings” i „Sign out” na dole.
- Middleware zamyka wszystko poza `PUBLIC_ROUTES` (S-01), więc nowy endpoint jest prywatny bez zmian w middleware.

## Desired End State

Na `/dashboard` karta „Alerts: active” z przyciskiem „Pause alerts” albo „Alerts paused — you won't get
notifications until you resume” z przyciskiem „Resume alerts”. Kliknięcie zapisuje stan i wraca na dashboard
z potwierdzeniem. Pauza trwa do ręcznego wznowienia, przeżywa zapis ustawień na `/settings`, a poller nie wysyła
w tym czasie alertów. Smoke i pgTAP pokrywają przełączanie.

### Key Discoveries:

- Endpoint przyjmuje jawny stan docelowy (`paused=true|false`), nie „przełącz”: podwójne kliknięcie lub ponowne
  wysłanie formularza nie odwraca stanu.
- Po wznowieniu samolot wypatrzony w czasie pauzy dostanie alert, jeśli nadal jest w oknie 2–15 min — w pauzie nic
  nie trafia do `alert_notifications`, więc deduplikacja go nie blokuje. To zgodne z Business Logic PRD
  („only while alerts are not paused”).

## What We're NOT Doing

- Pauzy do daty, okresów (1 h / 8 h) ani cichych godzin — pauza trwa do ręcznego wznowienia.
- Przełącznika na `/settings` — tylko dashboard.
- Wiadomości na Telegram przy pauzie/wznowieniu.
- Migracji ani zmian w pollerze.
- Wdrożenia na produkcję — zmiana wejdzie przy następnym deployu (poller i tak nie działa na produkcji).

## Implementation Approach

Jedna faza: czysta funkcja parsująca z testem, endpoint wzorem `telegram-test.ts`, karta na dashboardzie, kroki
smoke i asercja pgTAP. Wszystko weryfikowalne lokalnie jednym przebiegiem bramek.

## Faza 1: Pauza i wznowienie na dashboardzie

### Overview

Przełącznik pauzy na dashboardzie, zapisujący istniejącą kolumnę `paused`.

### Changes Required:

#### 1. Parsowanie formularza pauzy

**File**: `src/lib/alert-settings.ts`, `src/lib/alert-settings.test.ts` (nowy)

**Intent**: Walidacja stanu docelowego w czystym module, testowalnym w Vitest.

**Contract**: `parsePauseForm(form: FormData): { ok: true; paused: boolean } | { ok: false; error: string }`.
Pole `paused`: `"true"` → `true`, `"false"` → `false`; brak lub inna wartość → błąd „Invalid pause request”.
Test: `"true"`, `"false"`, brak pola, `"yes"`, `"TRUE"` (odrzucone — tylko dokładne wartości).

#### 2. Endpoint pauzy

**File**: `src/pages/api/settings/pause.ts` (nowy)

**Intent**: Zapis pauzy pod RLS, tą samą ścieżką błędów co pozostałe formularze ustawień.

**Contract**: `export const POST: APIRoute`. Brak `locals.user` → `/auth/signin`; `createClient()` `null` →
`/dashboard?alerts_error=Supabase is not configured`; błąd parsowania → `/dashboard?alerts_error=<błąd>`;
`update({ paused, updated_at })` dla `user_id = user.id` z `.select("user_id")`; błąd zapisu →
`/dashboard?alerts_error=<message>`; 0 wierszy → `alerts_error` „Your settings record is missing. Please contact
support.”; sukces → `/dashboard?alerts=paused` albo `/dashboard?alerts=resumed`. Wartości w URL przez
`encodeURIComponent`.

#### 3. Karta alertów na dashboardzie

**File**: `src/pages/dashboard.astro`

**Intent**: Stan pauzy widoczny od razu po zalogowaniu, z jednym przyciskiem do zmiany.

**Contract**: odczyt `alert_settings.paused` dla `user.id` przez `createClient()` (obsługa `null` i błędu jak
w karcie crona: komunikat „Alert status unavailable.” bez przycisku). Karta nad przyciskami: aktywne → tekst
„Alerts: active” i formularz `POST /api/settings/pause` z ukrytym `paused=true` i przyciskiem „Pause alerts”;
wstrzymane → wyróżniony (amber, jak ostrzeżenie crona) tekst „Alerts paused — you won't get notifications until you
resume” i formularz z `paused=false`, przycisk „Resume alerts”. `?alerts=paused|resumed` pokazuje krótkie
potwierdzenie, `?alerts_error=` komunikat błędu w karcie. Klasy łączone przez `cn()`.

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Round-trip pauzy przez HTTP i dowód, że zapis ustawień jej nie zdejmuje.

**Contract**: kroki po zalogowaniu (po krokach ustawień, przed wylogowaniem): dashboard zawiera „Alerts: active”;
`POST /api/settings/pause` z `paused=true` → `302 /dashboard?alerts=paused`; dashboard zawiera „Alerts paused”;
zapis ustawień (`settingsForm`) → `302 /settings?saved=1`; dashboard nadal zawiera „Alerts paused”; `paused=maybe`
→ `302 /dashboard?alerts_error=`; `paused=false` → `302 /dashboard?alerts=resumed`; dashboard zawiera „Alerts:
active”. Po wylogowaniu: `POST /api/settings/pause` → `302 /auth/signin`.

#### 5. pgTAP

**File**: `supabase/tests/alert_settings_rls.sql`

**Intent**: Dowód, że użytkownik wstrzymuje tylko własne alerty.

**Contract**: dwie nowe asercje (`plan(15)` → `plan(17)`): użytkownik A ustawia `paused = true` we własnym wierszu
i odczytuje `true`; `update ... set paused = true` użytkownika B na wierszu A nie zmienia wartości A.

#### 6. Dokumentacja

**File**: `README.md`

**Intent**: Opis funkcji dla kolejnej osoby.

**Contract**: w sekcji o alertach Telegram jedno zdanie: pauza na dashboardzie wstrzymuje alerty do wznowienia,
zadanie cykliczne biegnie dalej, ustawienia zostają.

### Success Criteria:

#### Automated Verification:

- Lint, testy, typecheck i build czyste: `npm run lint && npm test && npx astro sync && npx astro check && npm run build`
- Testy bazy przechodzą z nowymi asercjami: `npm run test:db`
- Smoke przechodzi z krokami pauzy na `npm run dev`: `npm run smoke`

#### Manual Verification:

- Na dashboardzie „Pause alerts” zmienia kartę na stan wstrzymany z potwierdzeniem, a „Resume alerts” przywraca stan aktywny
- Przy `npm run cron:local` i pauzie log biegu pokazuje użytkownika pominiętego (`users` mniejsze o 1), a po wznowieniu wraca
- Zapis ustawień na `/settings` w czasie pauzy nie zdejmuje pauzy

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręcznym potwierdzeniu.

---

## Testing Strategy

### Unit Tests:

- `src/lib/alert-settings.test.ts`: `parsePauseForm` dla `"true"`, `"false"`, braku pola, `"yes"`, `"TRUE"`.

### Integration Tests:

- Smoke: pauza → dashboard → zapis ustawień → pauza trwa → błędna wartość → wznowienie → anonim po wylogowaniu.
- pgTAP: własny `paused` zapisywalny, cudzy nie.

### Manual Testing Steps:

1. `npm run dev`, zaloguj się, na dashboardzie „Pause alerts”.
2. `npm run cron:local`: w logu `users` mniejsze o 1; brak alertów na Telegram.
3. Na `/settings` zapisz ustawienia, wróć na dashboard: nadal „Alerts paused”.
4. „Resume alerts”: w kolejnym biegu `users` wraca.

## Migration Notes

Brak migracji — kolumna `paused` istnieje. Na produkcji kolumna jest od 2026-09-28.

## References

- PRD: `context/foundation/prd.md` (FR-006, Business Logic „only while alerts are not paused”)
- Roadmapa: `context/foundation/roadmap.md` (S-05)
- Wzorce: `src/pages/api/settings/telegram-test.ts`, `src/pages/dashboard.astro` (karta crona),
  `src/lib/alert-settings.ts`, `supabase/tests/alert_settings_rls.sql`, `scripts/smoke.mjs`
- Poller: `src/workers/alert-poller.ts:52`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pauza i wznowienie na dashboardzie

#### Automated

- [x] 1.1 Lint, testy, typecheck i build czyste — dfe4a3e
- [x] 1.2 Testy bazy przechodzą z nowymi asercjami — dfe4a3e
- [x] 1.3 Smoke przechodzi z krokami pauzy — dfe4a3e

#### Manual

- [x] 1.4 „Pause alerts” i „Resume alerts” zmieniają kartę z potwierdzeniem — dfe4a3e
- [x] 1.5 W pauzie bieg crona pomija użytkownika, po wznowieniu wraca — dfe4a3e
- [x] 1.6 Zapis ustawień w pauzie nie zdejmuje pauzy — dfe4a3e
