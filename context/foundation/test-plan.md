# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-10

## 1. Strategy

Testy w tym projekcie stosują trzy niepodważalne zasady:

1. **Cost × signal.** Wygrywa najtańszy test, który daje rzeczywisty sygnał
   dla ryzyka. Nie promuj testu do e2e, bo e2e „wydaje się bezpieczniejsze”.
   Nie nakładaj modelu wizji na deterministyczny diff, który już wykrywa
   regresję.
2. **User concerns are first-class evidence.** Ryzyka zakotwiczone w „autor
   obawia się X, a awaria ujawniłaby się gdzieś w <obszar>” mają tę samą wagę
   co linie PRD lub dane hot-spotów.
3. **Risks are scenarios, not code locations.** Ten plan dokumentuje, _co
   może zawieść_ i _dlaczego uważamy to za prawdopodobne_ — na podstawie
   dokumentów, wywiadu i _sygnału_ z bazy kodu (częstotliwość zmian,
   struktura, baza testów). NIE twierdzi, że wie, która linia odpowiada za
   awarię. Tę wiedzę wytwarza `/10x-research` w każdym etapie wdrożenia.
   Jeśli plan i research nie zgadzają się co do miejsca awarii, research jest
   źródłem prawdy.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `supabase/tests/`, `scripts/` (30 dni do 2026-10-09; 26 commitów w zakresie).

## 2. Risk Map

Główne scenariusze awarii, przed którymi projekt musi się chronić, w kolejności
ryzyko = wpływ × prawdopodobieństwo. Ryzyka są scenariuszami awarii w
kategoriach użytkownika, nie nazwami testów. Kolumna Source cytuje _dowód,
który podniósł ryzyko_ — nigdy konkretny plik jako „miejsce awarii” (to zadanie
researchu, zob. §1 zasada #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pasujący samolot przelatuje w promieniu, alert nie wychodzi, a ślad biegu nie odróżnia tego od „pustego nieba”                                                                                                                                                        | High   | High       | interview Q1, Q3, Q4; PRD Success Criteria (Primary), NFR < 60 s; infrastructure.md Risk Register (cicha awaria crona, M/H); hot-spot dir `src/workers` (7 commits/30d), `src/lib` (16 commits/30d)                                                          |
| 2   | Ta sama maszyna wywołuje kolejne alerty w oknie 60 min (zmiana znaku wywoławczego; błąd 400/403 ponawiany więcej niż raz na użytkownika w jednym biegu; 429 nie wstrzymuje reszty biegu). Nakładające się biegi to znana, odłożona luka (roadmap Parked), poza Fazą 1 | High   | High       | interview Q1; PRD Guardrails „No spam”, FR-010; archive `first-advance-alert` impl-review F1 (przyjęty Fix A: limit prób na bieg, nie trwałe wstrzymanie), F2; roadmap Parked (blokada biegu przed wdrożeniem pollera); research Fazy 1 (korekta 2026-10-10) |
| 3   | Awaria lub spowolnienie jednej zależności zewnętrznej (źródło trasy, źródło ADS-B, Telegram dla jednego użytkownika) opóźnia lub blokuje alerty, które jej nie potrzebują                                                                                             | High   | Medium     | interview Q4; PRD Guardrails „A missing route never delays or blocks a notification”; archive `route-in-alerts` impl-review F1; adsb-source.md (blokada IP przy nadmiarze 4xx); infrastructure.md Risk Register (limit subrequestów, M/H)                    |
| 4   | Reguła dopasowania myli się na granicach: samolot poza promieniem dostaje alert, pasujący nie dostaje, brakuje oznaczenia „już blisko” lub horyzontu 2–15 min                                                                                                         | High   | Medium     | PRD US-01 Acceptance Criteria, Business Logic (prawdopodobieństwo wynika z krytyczności wg PRD, nie z churn; research Fazy 1 wykazał, że churn w `src/lib` dotyczy innych obszarów)                                                                          |
| 5   | Lokalizacja domu lub chat ID jednego użytkownika jest widoczna albo zapisywalna dla innego zalogowanego, lub wycieka do logów i rekordów błędów                                                                                                                       | High   | Medium     | PRD Guardrails (prywatność lokalizacji), Access Control; archive `minute-cron-heartbeat` impl-review F1, F2; archive `first-advance-alert` impl-review F3; hot-spot dir `src/pages/api` (11 commits/30d), `supabase/migrations` (6 commits/30d)              |
| 6   | Aktualizacja zależności psuje sesję na workerd: zalogowany traci dostęp albo niepubliczna trasa przestaje wymagać logowania                                                                                                                                           | High   | Medium     | infrastructure.md Risk Register (`@supabase/ssr` na workerd, M/H); archive `invite-only-access`; hot-spot dir `scripts` (16 commits/30d)                                                                                                                     |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                                                                                                        | Must challenge                                                                                                                          | Context `/10x-research` must ground                                                                                                                                                                       | Likely cheapest layer                                                                                                                                                                     | Anti-pattern to avoid                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Dla danych z pasującym samolotem bieg wysyła dokładnie jedno powiadomienie; gdy pobranie lub wysyłka zawiedzie, ślad biegu niesie błąd, a nie wygląda jak bieg bez wyników                                                                                                                                                                                                         | „Bieg zakończony bez wyjątku = poprawny bieg”                                                                                           | punkt wejścia biegu; granice zależności (źródło ADS-B, wysyłka, baza); co trafia do śladu biegu; czy warstwa integracji jest możliwa w obecnym podziale unit/workerd                                      | integracja pollera z fałszywymi granicami zewnętrznymi                                                                                                                                    | test sprawdzający tylko wywołanie funkcji, bez asercji na wysłany alert i treść śladu; udawanie, że test dowodzi widoczności „źródło parsuje się, ale nic nie pasuje”. Dziś to luka produktu, ślad pokazuje `ok`, więc decyzja należy do planu lub użytkownika |
| #2   | Drugi bieg z tą samą maszyną (inny znak wywoławczy, ta sama rejestracja lub adres) nie wysyła alertu; przy 400/403 w jednym biegu jest najwyżej jedna próba na użytkownika, a jego pozostali kandydaci są pomijani; przy 429 do końca biegu nikt nie dostaje wysyłki, a błąd podaje liczbę pominiętych. Ponowna próba w następnym biegu jest przyjętym zachowaniem, a nie regresją | „Deduplikacja działa, bo czysta funkcja ma test”; „trwały błąd nie powinien być ponawiany w kolejnym biegu” (przeczy przyjętej decyzji) | gdzie zapisuje się pamięć deduplikacji względem wysyłki; kolejność zapis/wysyłka; luki z założenia (adres TIS-B bez rejestracji, wysłane, ale niezapisane) do udokumentowania, a nie „naprawiania” testem | integracja dwóch kolejnych biegów                                                                                                                                                         | oczekiwana wartość skopiowana z implementacji okna zamiast z FR-010 (60 min, airframe)                                                                                                                                                                         |
| #3   | Gdy źródło trasy nie odpowiada, alert wychodzi z „trasa nieznana” w budżecie czasu; błąd wysyłki do jednego użytkownika nie blokuje pozostałych                                                                                                                                                                                                                                    | „Ponowienie się udało, bo końcowy status to 200”                                                                                        | timeouty; izolacja błędów per użytkownik; budżet czasu biegu                                                                                                                                              | integracja z fałszywymi zależnościami zwracającymi błędy i opóźnienia                                                                                                                     | nadmierne mockowanie wnętrzności pollera zamiast samych granic HTTP                                                                                                                                                                                            |
| #4   | Przypadki graniczne z PRD (tuż poza promieniem, < 2 min, > 15 min, samolot na ziemi) dają oczekiwaną decyzję                                                                                                                                                                                                                                                                       | „Istniejące testy unit już to pokrywają”                                                                                                | czy istniejące testy mają wyrocznię niezależną od kodu (wartości z geometrii lub PRD)                                                                                                                     | unit z tabelą przypadków granicznych w realistycznej szerokości geograficznej (nie na równiku, gdzie cos(lat)=1 maskuje błąd odległości) + pokrycie dopasowania typu, które nie ma testów | problem wyroczni: oczekiwane minuty i kilometry przepisane z bieżącego wyniku funkcji albo wyszukane samą funkcją                                                                                                                                              |
| #5   | Użytkownik B nie czyta i nie zmienia ustawień ani chat ID użytkownika A; rekordy błędów i logi nie zawierają współrzędnych domu                                                                                                                                                                                                                                                    | „RLS jest włączone, więc dane są izolowane”                                                                                             | polityki i uprawnienia tabel; co endpointy i biegi zapisują w polach błędów                                                                                                                               | pgTAP + smoke z dwoma kontami                                                                                                                                                             | test z jednym kontem (sprawdza uwierzytelnienie, nie własność)                                                                                                                                                                                                 |
| #6   | Po aktualizacji zależności zalogowany przechodzi round-trip ustawień, a każda niepubliczna trasa przekierowuje anonima                                                                                                                                                                                                                                                             | „Build przeszedł = auth działa na workerd”                                                                                              | które trasy obejmuje dziś smoke; czy smoke biegnie na runtime workerd                                                                                                                                     | istniejący smoke w CI, rozszerzony o listę tras                                                                                                                                           | e2e w przeglądarce tam, gdzie wystarczy smoke HTTP                                                                                                                                                                                                             |

## 3. Phased Rollout

Każdy wiersz to osobny etap wdrożenia, który otwiera własny folder zmiany przez
`/10x-new`. Status przechodzi od lewej do prawej przez wartości ze schematu;
orkiestrator aktualizuje go w miarę pojawiania się artefaktów na dysku.

| #   | Phase name               | Goal (one line)                                                                                             | Risks covered     | Test types                                                | Status      | Change folder                                 |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------- | ----------- | --------------------------------------------- |
| 1   | Poller critical path     | Udowodnić, że pasujący samolot daje dokładnie jeden alert, a powtórka w oknie go nie daje                   | #1, #2, #4        | integration (fake external edges) + unit (boundary table) | researched  | context/changes/testing-poller-critical-path/ |
| 2   | External edge resilience | Udowodnić, że awaria źródła, trasy lub Telegrama jest widoczna w śladzie biegu i nie blokuje innych alertów | #3, #1            | integration with injected errors/delays                   | not started | —                                             |
| 3   | Data isolation and leaks | Udowodnić brak dostępu między kontami i brak współrzędnych domu w rekordach błędów                          | #5                | pgTAP + two-account smoke                                 | not started | —                                             |
| 4   | Quality-gates floor      | Zablokować w CI nowe zestawy i ochronę tras po aktualizacjach zależności                                    | #6, cross-cutting | smoke (route list), CI gates, post-edit hook (local)      | not started | —                                             |

## 4. Stack

Klasyczna baza testów projektu. Profil bazy testów: `sparse` — skonfigurowany
Vitest, 6 plików unit wyłącznie w `src/lib/`, 4 pliki pgTAP (RLS), jeden smoke
HTTP; brak testów stron, endpointów i pollera.

| Layer                | Tool                                                                                                             | Version          | Notes                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                 | Vitest                                                                                                           | ^5.0.3           | Tylko czyste moduły `src/lib` w Node, bez `astro:*` i Supabase (CLAUDE.md)                                                                                       |
| integration (poller) | Vitest przez `vitest.integration.config.ts` (`npm run test:integration`)                                         | ^5.0.3           | Node bez Astro i workerd, pliki `src/workers/**/*.integration.test.ts`; granice fałszywe (zob. API mocking), lokalna Supabase nieużywana (decyzja w §6.6)        |
| DB permissions       | pgTAP przez `supabase test db`                                                                                   | Supabase CLI     | Polityki RLS i uprawnienia tabel                                                                                                                                 |
| HTTP smoke           | `scripts/smoke.mjs`                                                                                              | —                | Auth flow na workerd przeciw lokalnej Supabase; konto przez Admin API                                                                                            |
| API mocking          | `fetch` podmieniony per host (`vi.stubGlobal`) + fake klienta Supabase w pamięci (`src/workers/poller-fakes.ts`) | — (część Vitest) | Fałszywe tylko granice zewnętrzne (ADS-B, adsbdb, Telegram) i klient Supabase; żądanie do nieznanego hosta oblewa test                                           |
| e2e                  | none — not planned                                                                                               | —                | Smoke HTTP pokrywa przepływy krytyczne taniej (cost × signal)                                                                                                    |
| (optional) AI-native | Built-in browser / Playwright MCP — checked: 2026-10-09                                                          | n/a              | Ręczna weryfikacja ekranu ustawień po zmianie UI. When NOT to use: do asercji logiki alertów, dedup i auth — tam smoke i integracja dają deterministyczny sygnał |

**Stack grounding tools (current session):**

- Docs: none — Context7 / docs MCP not available in current session; versions read from `package.json`; checked: 2026-10-09
- Search: WebSearch / WebFetch available — not used (no version-dependent recommendation required yet); checked: 2026-10-09
- Runtime/browser: built-in browser pane and Claude in Chrome available — possible manual verification of settings screen, not used; checked: 2026-10-09
- Provider/platform: GitHub / Cloudflare / Supabase MCP not available in current session; CI state read from `.github/workflows/ci.yml`; checked: 2026-10-09

## 5. Quality Gates

| Gate                                             | Where              | Required?                                                  | Catches                                                  |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------- | -------------------------------------------------------- |
| lint + typecheck (`npm run lint`, `astro check`) | local + CI         | required (wired)                                           | dryf składni i typów                                     |
| unit (`npm test`)                                | local + CI         | required (wired)                                           | regresje czystej logiki                                  |
| DB permissions (`supabase test db`)              | CI                 | required (wired)                                           | regresje RLS i uprawnień                                 |
| HTTP smoke on workerd                            | CI                 | required (wired); route coverage extended after §3 Phase 4 | zepsuta sesja, otwarte trasy                             |
| poller integration (`npm run test:integration`)  | local + CI         | required (wired)                                           | brak alertu, powtórzony alert                            |
| edge-failure integration                         | local + CI         | required after §3 Phase 2                                  | blokowanie alertów przez jedną zależność                 |
| two-account isolation                            | CI                 | required after §3 Phase 3                                  | dostęp między kontami, wyciek współrzędnych              |
| post-edit hook                                   | local (agent loop) | recommended after §3 Phase 4                               | regresje w handlerze zadania cyklicznego w chwili edycji |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja jest wypełniana po
ukończeniu odpowiedniego etapu; wcześniej brzmi „TBD — see §3 Phase <N>”.

### 6.1 Adding a unit test

- **Gdzie:** `src/lib/<moduł>.test.ts`, obok testowanego modułu. Tylko czyste moduły: bez `astro:*` i bez Supabase.
  Moduł, który ich potrzebuje, dostaje je parametrem albo trafia do §6.2.
- **Importy:** jawnie `import { describe, expect, it } from "vitest";`; testowany moduł przez alias `@/lib/<moduł>`.
- **Uruchomienie:** `npm test` (`vitest.config.ts`, Node, `include: src/lib/**/*.test.ts`); w CI w jobie `ci`.
- **Wzorzec tabeli granicznej** (ryzyko #4):
  1. Realistyczne wejście: dom w Warszawie (`WARSAW = { lat: 52.23, lon: 21.01 }`), nie na równiku, gdzie
     `cos(lat) = 1` ukrywa błąd przeliczenia odległości wschód–zachód.
  2. Wyrocznia z geometrii lub PRD, z wyprowadzeniem w komentarzu nad helperem: odległość = prędkość × czas
     (360 kt = 0,1852 km/s), przesunięcie wzdłuż południka `dLat = D / R`, przesunięcie wzdłuż równoleżnika z
     odwróconego haversine `dLon = 2·asin(sin(X / 2R) / cos(lat))`, R = 6371 km. Promień, horyzont 2–15 min,
     „już blisko” i „na ziemi” wprost z PRD.
  3. Marginesy wokół granicy zamiast krawędzi float: 9,8 / 10,2 km przy promieniu 10 km, 1 / 14 / 16 min przy
     horyzoncie 2–15 min; jawne tolerancje (`±0.05` km, `±1` s). Dokładne krawędzie (120 s, 900 s) zostają w
     istniejących testach `predictPass`.
  4. Nigdy nie wyszukuj fixture'a samą testowaną funkcją i nie przepisuj oczekiwanej wartości z jej wyniku.
  5. Kilka wierszy tej samej reguły → `it.each` z etykietą w pierwszej kolumnie (`"%s"`).
  6. Lokalnie (bez commita) zepsuj regułę, np. usuń `cos(home.lat)`; nowy wiersz musi spaść. Przywróć kod.
- **Nowy przypadek dla `predictPass`:** dopisz wiersz do bloku `describe("predictPass at Warsaw")`, używając jego
  helperów: `northboundPasser(offsetKm, side)` (przelot X km na wschód `1` lub zachód `-1` od domu, 5 min przed
  najbliższym punktem), `inboundOverWarsaw(seconds, overrides)` (przelot nad domem za `seconds`),
  `warsawLatOffsetDeg(km)` / `warsawLonOffsetDeg(km)` (przesunięcia z geometrii sferycznej) oraz `aircraft(overrides)`
  z góry pliku (samolot w powietrzu, 360 kt, świeża pozycja).
- **Szkielet:**

  ```ts
  // Oracle: <geometry or PRD line>, e.g. 13 min * 60 s * 0.1852 km/s = 144.5 km due north, inside the 2–15 min horizon.
  it("alerts a pass 13 min ahead as a regular alert", () => {
    const prediction = predictPass(inboundOverWarsaw(13 * 60), WARSAW, RADIUS_KM);
    expect(prediction).not.toBeNull();
    expect(prediction?.alreadyClose).toBe(false);
  });
  ```

- **Reference tests:** `src/lib/flyover.test.ts`, blok `describe("predictPass at Warsaw")` (np. „alerts a pass 9.8 km
  %s of home, 5 min ahead”, „does not alert a pass 10.2 km %s of home (outside the radius)”);
  `src/lib/cron-runs.test.ts`, `describe("describeRunOutcome")` (tabela „maps %s” i „cuts a long joined error text to
  exactly 500 characters”).

### 6.2 Adding a poller integration test

- **Gdzie:** `src/workers/<nazwa>.integration.test.ts`; fałszywe granice w `src/workers/poller-fakes.ts` (importowane
  wyłącznie przez testy integracyjne). Scenariusze `runAlertPoll` dopisuj do
  `src/workers/alert-poller.integration.test.ts`.
- **Uruchomienie:** `npm run test:integration` (`vitest.integration.config.ts`, Node bez Astro i workerd, ok. 2,5 s);
  w CI w jobie `ci` zaraz po `npm test`. `npm test` tych plików nie zbiera.
- **Reguły:**
  - Fałszujemy tylko granice: `fetch` po hoście (`opendata.adsb.fi`, `api.adsbdb.com`, `api.telegram.org`) i klienta
    Supabase w pamięci. Parser, klienci HTTP, predykcja, deduplikacja i formatowanie wiadomości biegną naprawdę. Bez
    `vi.mock` modułów `src/lib` i `src/workers`.
  - Nieznany host oblewa test: stub odrzuca żądanie i zapisuje host w `http.unexpected`, a `afterEach` sprawdza, że
    lista jest pusta (klienci połykają błędy sieci, więc sam wyjątek by umknął). Nowa zależność HTTP → najpierw dodaj
    jej host do `installFetchFake()`.
  - Asercje na obserwowalne wyjście: przechwycone żądania (`http.telegramMessages()`, `http.requestsTo(HOST)`), wiersze
    w fake'u (`db.notifications`), `summary` (`sent`, `matches`, `duplicates`, `errors`) i
    `describeRunOutcome(summary).status`. Nigdy „funkcja X została wywołana”. Każda asercja ma etykietę mówiącą, która
    granica i czego oczekiwano.
  - Token przekazuj parametrem: `runAlertPoll(db.client, () => NOW, TOKEN)` (`undefined` = brak tokenu). Testowany
    moduł nie importuje `astro:*`.
  - ≤ 2 użytkowników na scenariusz: między użytkownikami biegnie prawdziwa przerwa `ADSB_REQUEST_GAP_MS` (ok. 1,1 s);
    fake timers celowo nieużywane.
  - Odpowiedzi Telegrama w kształcie prawdziwego API (`telegramOk()`, `telegramError(status, description)`); goły 200
    bez `{ ok: true }` klient czyta jako porażkę.
  - Geometria fixture'a liczona niezależnie i opisana w komentarzu (jak `MATCHING_POSITION`: 0,9994° na północ ≈
    111,12 km, kurs 180, 360 kt → „~10 min (14:10)”, „Approaching from N”); oczekiwany tekst nie pochodzi z
    `formatAlertMessage`. Okno deduplikacji z FR-010 na poziomie minut (59 / 61 min), nie krawędź `>=` z kodu.
  - Fake Supabase zna tylko generyczne filtry (`eq`, `not(col, "is", null)`, `gte`, `order`) i `insert`, a `sent_at`
    wypełnia zegarem fake'a (odpowiednik `now()` w bazie). Nie dodawaj mu wiedzy o tym, czego oczekuje poller; nowy
    kształt zapytania → rozszerz `FakeSelect` generycznie (nieobsługiwana operacja rzuca wyjątek).
- **Helpery z `poller-fakes.ts`:**
  - Stałe: `NOW` (2026-10-10T12:00Z = 14:00 w Warszawie, CEST), `TOKEN`, `HOME`, `DEFAULT_USER_ID`, `DEFAULT_CHAT_ID`,
    hosty `ADSB_HOST`, `ROUTE_HOST`, `TELEGRAM_HOST`.
  - `alertUser(overrides)` — wiersz `alert_settings`: dom w `HOME`, promień 10 km, typy `["B738"]`, bez pauzy.
  - `feedEntry(overrides)` — surowy wpis adsb.fi (`hex, t, r, flight, lat, lon, track, gs, alt_baro, seen_pos`);
    wartość `undefined` usuwa pole z JSON.
  - `installFetchFake()` → `http` z polami do ustawienia `adsb` (jedna odpowiedź na każde żądanie), `route` (domyślnie
    404 = trasa nieznana), `telegram` (kolejka odpowiedzi; pusta = sukces) i zapisem `requests` / `unexpected`.
    Odpowiedzi: `feedReply(entries)`, `jsonReply(status, value)`, `{ status, body }` dla treści, która nie jest JSON.
  - `createFakeSupabase({ clock, settings, notifications })` → `db.client`, żywe tabele `db.settings` /
    `db.notifications` (wiersze przeżywają kolejne biegi na tym samym `db`); wstrzykiwanie błędów:
    `db.settingsError`, `db.recentError`, `db.insertError` = `postgrestError(message)`.
  - W pliku testu: `matchingAircraft(overrides)` (pasujący B738 `48af01` / `SP-LWA` / `LOT3`), `seedDatabase(settings)`,
    `SECOND_USER`, `secondMatchingAircraft()`, `earlierAlert(userId, sentAt)` (wiersz z wcześniejszego biegu) i
    tabela `FAILURES` — nowa zgłaszana awaria to nowy wiersz z fragmentem błędu i liczbą wysyłek.
- **Kroki dla nowego scenariusza:**
  1. Nazwij ryzyko z §2 i wyrocznię (linia PRD / FR, geometria).
  2. Zasiej `createFakeSupabase` (lub `seedDatabase`); dla dwóch biegów użyj tego samego `db` i zmiennej `clock`
     przesuwanej między biegami.
  3. Ustaw `http.adsb`, w razie potrzeby `http.telegram` i błędy w `db`.
  4. Wywołaj `runAlertPoll(db.client, () => NOW, TOKEN)`.
  5. Sprawdź żądania, wiersze, `summary` i status śladu; dodaj wiersz kontrolny, który dowodzi, że test nie przechodzi
     dlatego, że wszystko jest blokowane.
  6. Lokalnie (bez commita) zmutuj kod produkcyjny, który test ma pilnować; test musi spaść. Przywróć kod.
- **Szkielet:**

  ```ts
  it("does not alert a type the user does not watch", async () => {
    const db = createFakeSupabase({ clock: () => NOW, settings: [alertUser({ aircraft_types: ["A320"] })] });
    http.adsb = feedReply([matchingAircraft()]);

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage requests").toHaveLength(0);
    expect(summary.errors, "run errors").toEqual([]);
    expect(db.notifications, "recorded alert_notifications rows").toEqual([]);
  });
  ```

- **Reference tests** (`src/workers/alert-poller.integration.test.ts`): „risk #1: one matching aircraft gives exactly
  one alert” › „sends one correct alert and records it, ignoring another type on the same track”; „risk #2: no repeat
  for the same airframe within the window” › „run 2 one minute later: %s” (dwa biegi na jednym `db`, zegar + 1 min,
  wiersz kontrolny). Zgłaszana awaria w śladzie: „risk #1: a reported failure is visible in the run trace” (tabela
  `FAILURES`).

### 6.3 Adding a test for an external-dependency failure

- TBD — see §3 Phase 2 for „dependency down/slow → alert still sent or failure visible in run trace” pattern.

### 6.4 Adding a test for a new table or endpoint with user data

- TBD — see §3 Phase 3 for two-account ownership and no-coordinates-in-errors pattern.

### 6.5 Adding a route to the smoke

- TBD — see §3 Phase 4 for anonymous-redirect and authenticated round-trip pattern.

### 6.6 Per-rollout-phase notes

(Uzupełniane po każdym etapie.)

**Phase 1 — Poller critical path** (`testing-poller-critical-path`, 2026-10-10)

- **Decyzja warstwy integracji:** Node + Vitest z fałszywymi granicami (`fetch` po hoście, Supabase w pamięci).
  Lokalna Supabase nie jest używana: wymagałaby nowego wyjątku dla klucza `service_role` w kodzie testów, nie pozwala
  wstrzyknąć błędu w pojedyncze zapytanie i nie daje dodatkowego sygnału dla scenariuszy tej fazy. Wrócić do niej, gdy
  test będzie potrzebował prawdziwej bazy (blokada biegu przed wdrożeniem pollera).
- **Szwy produkcyjne:** token Telegrama jest parametrem `runAlertPoll`; reguła „błędy biegu → status i treść śladu”
  to czysta funkcja `describeRunOutcome` (limit `MAX_RUN_ERROR_CHARS = 500`) w `src/lib/cron-runs.ts`. Testowane jest
  mapowanie, nie zapis wiersza `cron_runs` ani retencja.
- **Znane luki bez testów (świadomie):**
  - „Źródło parsuje się, ale nic nie pasuje” — wpisy bez pozycji (liczone jako pominięte) albo bez typu zostawiają bieg
    `ok`, nieodróżnialny od pustego nieba. Luka produktu, nie testu: roadmap `## Parked` („Widoczność dryfu formatu
    ADS-B w śladzie biegu”). Test „feed entry without a type” potwierdza tylko poprawne zachowanie dla jednego
    samolotu.
  - Ponowna próba w następnym biegu po 400/403 — przyjęte zachowanie (archive `first-advance-alert` impl-review F1,
    Fix A: limit prób na bieg). Żaden test jej nie zakazuje; trwałe wstrzymanie (Fix B) to decyzja produktowa.
  - Adres TIS-B (`~`) bez rejestracji nigdy się nie deduplikuje — spekulatywne (typowany cel TIS-B nie był widziany w
    danych), możliwy konflikt z FR-010 do decyzji; zachowanie przypina tylko test unit czystej funkcji deduplikacji.
  - Wysłane, ale niezapisane (błąd zapisu po udanej wysyłce) — asertowany jest tylko błąd w śladzie („alert sent but
    not recorded”), nie powtórka w następnym biegu.
  - Nakładające się biegi — odłożone do wdrożenia pollera na serwer (roadmap `## Parked`); test wymagałby prawdziwej
    bazy.
  - Opóźnienia i timeouty granic (trasa, ADS-B, wolna wysyłka) — należą do §3 Phase 2 (ryzyko #3).

## 7. What We Deliberately Don't Test

- **Skrypty pomocnicze** (pomiar ADS-B, seed słownika typów, lokalny wyzwalacz crona) — uruchamiane ręcznie i rzadko. Re-evaluate if któryś z nich zacznie działać automatycznie lub w CI. (Source: Phase 2 interview Q5.)
- **Dokładność predykcji przy skrętach i podejściach** — PRD świadomie akceptuje błędy predykcji liniowej. Re-evaluate if PRD zmieni model predykcji. (Source: PRD Business Logic.)
- **Weryfikacja właściciela chat ID i limit wiadomości testowej** — zabezpieczenie jeszcze nie istnieje (roadmap Parked). Re-evaluate przed otwarciem rejestracji lub wdrożeniem pollera na serwer. (Source: challenger finding.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-09
- Stack versions last verified: 2026-10-09
- AI-native tool references last verified: 2026-10-09

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
