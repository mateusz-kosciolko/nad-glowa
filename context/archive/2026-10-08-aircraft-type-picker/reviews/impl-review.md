<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Czytelny wybór typów samolotów (S-06)

- **Plan**: context/changes/aircraft-type-picker/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Uwagi (observations) nie obniżają werdyktu wymiaru; żadne ustalenie nie ma wagi WARNING ani CRITICAL.

Kryteria automatyczne uruchomione ponownie w przeglądzie: `supabase test db` PASS, typy zawierają `aircraft_types`, `npm run lint` OK, `astro check` 0 errors, `npm test` 67/67, `npm run build` OK, `npm run smoke` wszystkie kroki PASS. `supabase db reset` (1.1) nie był powtórzony, żeby nie kasować lokalnych kont; przeszedł podczas implementacji fazy 1. Kryteria ręczne 1.5, 2.4, 3.5–3.10 potwierdził użytkownik.

## Findings

### F1 — Wyszukiwanie: dwa zapytania `ilike` zamiast jednego `or`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/aircraft-types.ts:34-49
- **Detail**: Plan (Faza 2, kontrakt endpointu) mówi o `.or(…).limit(50)`. Implementacja robi dwa równoległe zapytania (prefiks kodu, fragment nazwy), każde `order("code").limit(50)`, scala je i rankuje. Zmiana świadoma: bez sortowania `limit(50)` mógł wypchnąć dokładne trafienie kodu przy szerokim zapytaniu („ai”), a brak ręcznie składanego filtra `or` usuwa problem spacji w zapytaniu. Plan nie został zaktualizowany.
- **Fix**: Dopisz do planu (Faza 2) notkę o adaptacji, żeby plan pozostał źródłem prawdy dla archiwum.
- **Decision**: FIXED — notka „Adaptacje z implementacji” w Fazie 2 planu

### F2 — Drobne zachowania wybieraka spoza planu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/settings/AircraftTypePicker.tsx:149, 158-166
- **Detail**: (a) Enter w polu wyszukiwania dodaje typ, gdy dostępna jest dokładnie jedna opcja (plan wymagał tylko, by Enter nie wysyłał formularza). (b) „Add code XXXX” pojawia się także po błędzie wyszukiwania, więc kod da się dodać przy niedziałającym endpoincie. (c) Prop `featuredUnavailable`. Wszystkie nieszkodliwe i potwierdzone ręcznie.
- **Fix**: Brak zmian w kodzie; ewentualnie wspomnieć w notce z F1.
- **Decision**: FIXED — objęte notką z F1 (bez zmian w kodzie)

### F3 — Brak komunikatu, gdy nazwy zapisanych typów nie dają się wczytać

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/settings.astro:59-62, src/components/settings/AircraftTypePicker.tsx:189
- **Detail**: Przy błędzie zapytania o słownik `typeNames` zostaje puste, więc każdy zapisany chip pokazuje „unknown name”, a komunikat mówi tylko o wyróżnionych typach. Użytkownik może uznać, że zapisane kody są błędne.
- **Fix**: Rozszerz komunikat: „Type names and highlighted types are unavailable right now. You can still search below.”
- **Decision**: FIXED — komunikat obejmuje teraz nazwy typów i wyróżnione

### F4 — Generator pobiera źródło z gałęzi `master`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/aircraft-types-seed.mjs:7
- **Detail**: URL wskazuje `master`, więc ponowne uruchomienie da inne dane. Bez wpływu na bezpieczeństwo, bo wynik jest zapisany w migracji; dotyczy tylko odtwarzalności.
- **Fix**: Zapisuj w nagłówku SQL commit tar1090-db (np. z GitHub API) albo przypnij URL do SHA.
- **Decision**: FIXED — generator przypina pobranie do commita tar1090-db i podaje go w nagłówku SQL (istniejąca migracja bez zmian; dane identyczne)

### F5 — Mieszane polskie i angielskie komentarze w skrypcie generatora

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/aircraft-types-seed.mjs:1-2, 10, 41, 56
- **Detail**: Pozostałe skrypty `.mjs` (`smoke.mjs`, `cron-local.mjs`, `adsb-measure.mjs`) mają komentarze po angielsku; po polsku piszemy tylko SQL. Generator miesza oba języki, także w jednym nagłówku.
- **Fix**: Przetłumacz komentarze w `aircraft-types-seed.mjs` na angielski (komentarze w generowanym SQL zostają po polsku).
- **Decision**: FIXED — komentarze w aircraft-types-seed.mjs po angielsku; komentarze generowanego SQL po polsku

### F6 — Zbędne zapytanie przy powrocie do poprzedniej frazy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/settings/AircraftTypePicker.tsx:79-100
- **Detail**: Przy `c17` → `c1` → `c17` wybierak od razu pokazuje zapamiętaną odpowiedź, ale i tak wysyła drugie identyczne zapytanie. Nieszkodliwe przy ~2,8 tys. wierszy i debounce 250 ms.
- **Fix**: W efekcie pomiń fetch, gdy `answer?.query === normalized`.
- **Decision**: FIXED — wybierak pomija fetch dla frazy z zapamiętaną odpowiedzią (ref answeredQuery, czyszczony po błędzie)
