# Historia alertów z usuwaniem (FR-011) — plan implementacji

## Overview

Użytkownik przegląda własną historię wysłanych alertów na `/alerts` i może usunąć wpis. Do tej pory użytkownik zarządzał
wyłącznie jednym wierszem ustawień; to odpowiedź na Open Question 9 z PRD (kolekcja rekordów zarządzana przez użytkownika).

## Current State Analysis

- `alert_notifications` nie ma polityk ani grantów dla `authenticated`; czyta i zapisuje wyłącznie handler `scheduled`
  (`supabase/migrations/20261005132125_alert_notifications.sql`). Komentarz migracji zapowiada politykę select z FR-011.
- Ta sama tabela jest pamięcią deduplikacji: poller czyta wpisy z ostatnich 60 minut (`src/workers/alert-poller.ts:149`,
  `DEDUP_WINDOW_MS` w `src/lib/alerts.ts`). Wiersz nie zawiera współrzędnych, więc odsłonięcie go właścicielowi jest bezpieczne.
- Wzorce: endpoint formularza `src/pages/api/settings/pause.ts`, kody błędów `src/lib/form-errors.ts`.

## Desired End State

- `/alerts` pokazuje najnowsze 100 alertów zalogowanego użytkownika, z pustym stanem i własnym komunikatem błędu odczytu.
- Wpis starszy niż okno deduplikacji da się usunąć; młodszy pokazuje, od kiedy będzie można.
- **Baza wymusza regułę okna:** polityka RLS `delete` przepuszcza tylko własne wiersze z `sent_at <= now() - 60 min`, więc
  żadne obejście UI nie wznowi powtórnego alertu.

## What We're NOT Doing

- Tworzenie i edycja wpisów przez użytkownika: wpisy powstają przy wysyłce alertu, a dziennik jest zapisem faktów.
- Soft delete, paginacja, retencja dziennika, zmiany w pollerze.
- Klucz `service_role` w testach E2E: seedowanie historii robi `scripts/smoke.mjs`, jedyny skrypt, któremu wolno go użyć.

## Phase 1: Historia i usuwanie

- Testy najpierw: `src/lib/alert-history.test.ts`, `supabase/tests/alert_notifications_rls.sql`, kroki w `scripts/smoke.mjs`,
  `tests/e2e/alert-history.spec.ts`.
- Migracja: granty `select, delete` dla `authenticated`, polityki „own alerts readable” i „own old alerts deletable”.
- `src/lib/alert-history.ts`, kody w `src/lib/form-errors.ts`, `POST /api/alerts/delete`, `src/pages/alerts.astro`, link z dashboardu.

### Success Criteria

#### Automated

- Lint, `astro check`, build, `npm test`, `npm run test:integration` czyste.
- `npm run test:db`: użytkownik czyta tylko swoje wpisy, nie usuwa świeżych ani cudzych, usuwa własne stare.
- `npm run smoke`: pełna ścieżka HTTP, w tym odmowa usunięcia świeżego wpisu.
- `npx playwright test`: wejście w historię z dashboardu.

#### Manual

- Lista w przeglądarce: stary wpis znika po usunięciu, świeży nie ma przycisku.

## Decisions

- **Reguła okna w RLS, a nie w endpoincie:** invariant deduplikacji ma obowiązywać niezależnie od kodu aplikacji. Koszt: 60 minut
  jest zapisane także w SQL. Zmiana `DEDUP_WINDOW_MS` wymaga nowej migracji (komentarz przy stałej).
- **Twarde usuwanie zamiast soft delete:** kolumna ukrycia wymagałaby filtrowania wszędzie, a „usuń” znaczyłoby „ukryj”.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Historia i usuwanie

#### Automated

- [x] 1.1 Lint, testy, typecheck i build czyste — 087cd8f
- [x] 1.2 Testy bazy przechodzą z nowymi asercjami — 087cd8f
- [x] 1.3 Smoke przechodzi z krokami historii — 087cd8f
- [x] 1.4 E2E przechodzi z wejściem w historię — 087cd8f

#### Manual

- [x] 1.5 Usunięcie starego wpisu w przeglądarce, świeży bez przycisku — 087cd8f
