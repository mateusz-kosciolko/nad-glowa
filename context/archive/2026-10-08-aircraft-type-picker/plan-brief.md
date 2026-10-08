# Czytelny wybór typów samolotów (S-06) — Plan Brief

> Full plan: `context/changes/aircraft-type-picker/plan.md`

## What & Why

S-06 z roadmapy (FR-002, FR-005): użytkownik wybiera typy samolotów z krótkiej listy wyróżnionych „ciekawych”
typów z czytelnymi nazwami, a poniżej może wyszukać w pełnej liście typów ICAO. Dziś trzeba znać kody ICAO
(B744, A400) i wpisać je ręcznie, co przeczy obietnicy PRD, że „ciekawy” wybiera się łatwo.

## Starting Point

Na `/settings` jest jedno pole tekstowe z kodami po przecinku, walidowane wzorcem `^[A-Z0-9]{2,4}$` i limitem 20.
Kody trafiają do `alert_settings.aircraft_types`, a poller dopasowuje do nich pole `t` z adsb.fi. W repo nie ma
słownika nazw typów.

## Desired End State

Na `/settings` jest wybierak: 14 wyróżnionych przełączników („AIRBUS A-400M · A400”), wyszukiwarka w ~2774 typach
po kodzie lub nazwie oraz chipy wybranych (n/20) z przyciskiem usunięcia. Kod spoza słownika da się dodać i
widać go jako „ZZZZ · unknown name”. Zapis, walidacja i alerty działają jak dotąd.

## Key Decisions Made

| Decision                 | Choice                                                                          | Why (1 sentence)                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Gdzie żyje słownik       | Tabela `aircraft_types` w Supabase + `GET /api/aircraft-types?q=`               | Mitygacja z `infrastructure.md` (bez listy w bundlu Workera); endpoint jest za logowaniem i pod RLS. |
| Źródło pełnej listy      | tar1090-db `icao_aircraft_types2.js`, migracja z generatora                     | 2788 kodów z nazwami, wszystkie zgodne ze wzorcem; seed.sql nie trafia na produkcję.                 |
| Lista wyróżnionych       | A400, C17, C30J, C130, A124, IL76, AN12, BLCF, A3ST, B748, K35R, E3TF, B52, H47 | Wojskowe i ciężkie transportowce z persony PRD; flaga `featured` w migracji.                         |
| Kody spoza słownika      | Dozwolone, chip „unknown name”; serwer sprawdza tylko wzorzec                   | Nic z zapisanych ustawień nie ginie, a słownik bez licencji nie staje się bramką.                    |
| Nazwa w alercie Telegram | Nie — tylko ustawienia                                                          | Zakres S-06 to wybór typów; poller zostaje nietknięty.                                               |
| Ścieżka zapisu           | Ukryte pole `aircraft_types` z kodami po przecinku                              | `parseAlertSettingsForm`, `POST /api/settings` i smoke działają bez zmian.                           |
| Ranking wyszukiwania     | Kod równy → prefiks kodu → nazwa zawiera; maks. 20; min. 2 znaki                | „C17” ma znaleźć C-17 przed typami z „C17” w nazwie.                                                 |

## Scope

**In scope:**

- Generator SQL z tar1090-db, migracja `aircraft_types` z RLS (odczyt tylko dla zalogowanych) i danymi, pgTAP
- Czysty moduł normalizacji zapytania i rankingu z testami Vitest, endpoint wyszukiwania, kroki smoke
- Wyspa `AircraftTypePicker` w formularzu ustawień, nazwy dla wyróżnionych i zapisanych kodów z SSR

**Out of scope:**

- Nazwy typów w powiadomieniach, walidacja kodów względem słownika, edycja wyróżnionych z UI
- Automatyczna aktualizacja słownika, pseudo-typy bez nazwy (`TWR`, `GND`, …), flaga wojskowa (FR-007)

## Architecture / Approach

Migracja tworzy `public.aircraft_types (code icao_type pk, name, featured)` i wstawia dane z generatora.
`/settings` przy renderowaniu jednym zapytaniem kluczem `anon` pobiera wyróżnione i nazwy zapisanych kodów, po czym
przekazuje je wyspie. Wyspa przy pisaniu (debounce 250 ms) pyta `GET /api/aircraft-types?q=`. Endpoint normalizuje
zapytanie do bezpiecznego alfabetu (filtr `or` PostgREST), pobiera do 50 trafień i rankuje je w czystym module.
Wybrane kody wracają do formularza ukrytym polem.

## Phases at a Glance

| Phase                          | What it delivers                                         | Key risk                                                 |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| 1. Słownik typów w bazie       | Tabela z 2774 typami i 14 wyróżnionymi, pgTAP            | Duża migracja z danymi; źródło bez licencji              |
| 2. Wyszukiwanie typów          | `GET /api/aircraft-types?q=` z rankingiem, Vitest, smoke | Wstrzyknięcie w filtr `or` PostgREST bez normalizacji    |
| 3. Wyspa wyboru w ustawieniach | Wybierak z wyróżnionymi, wyszukiwarką i chipami          | Pole wyszukiwania z `name` zdublowałoby `aircraft_types` |

**Prerequisites:** F-01 i S-02 zakończone (są); lokalna Supabase CLI do `db reset`, `test:db` i `db:types`.
**Estimated effort:** ~2 sesje w 3 fazach.

## Open Risks & Assumptions

- tar1090-db nie ma licencji; zakładamy, że publiczne dane ICAO Doc 8643 w niekomercyjnym projekcie są w porządku.
- Kod pasujący do wzorca, ale z literówką, zostanie zapisany i nigdy nie dopasuje samolotu (świadoma decyzja).
- Słownik się starzeje; nowe typy wymagają ręcznego uruchomienia generatora i nowej migracji.

## Success Criteria (Summary)

- Użytkownik wybiera ciekawe typy bez znajomości kodów ICAO: klika wyróżnione albo wyszukuje po nazwie.
- Zapisane wcześniej typy, także spoza słownika, pozostają po zapisie, a alerty działają jak dotąd.
- pgTAP, Vitest, smoke, lint, `astro check` i build przechodzą.
