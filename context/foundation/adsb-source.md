---
decided_at: 2026-09-28
change_id: adsb-source-verified
primary: adsb.fi
fallback: adsb.lol
reachable_from_cloudflare_workers: false
status: local-only
runtime: local
---

# Źródło danych ADS-B

Decyzja fundamentu F-01 (`adsb-source-verified`). Odwołują się do niej S-03, S-06 i S-07.
Liczby są przepisane z pomiaru, bo folder zmiany zostanie zarchiwizowany.
Klient: `src/lib/adsb.ts`. Sonda diagnostyczna: `GET /api/adsb/probe` (`src/pages/api/adsb/probe.ts`).

## Decyzja

**Pod względem jakości danych:** źródłem podstawowym jest **adsb.fi**, zapasowym **adsb.lol**. Oba mają ten sam
format odpowiedzi, więc zapas to zmiana parametru `source` klienta, nie nowy parser. adsb.fi spełnia próg z planu
(typ u 94,9% samolotów w powietrzu, 100% kodów zgodnych z `ICAO_TYPE_PATTERN`). Typy są standardowymi kodami ICAO,
więc S-03 nie potrzebuje mapowania do ustawień z S-02.

**Pod względem dostępności:** żadne z dwóch źródeł nie jest osiągalne z produkcyjnego Workera na Cloudflare.
adsb.fi odpowiada 403, adsb.lol odpowiada 429 (szczegóły w „Dostępność z produkcji”). Z sieci spoza Cloudflare ten
sam kod działa dla obu źródeł.

Wniosek: wybór źródła stoi, ale miejsce, z którego aplikacja pobiera dane ADS-B, jest otwartą decyzją
(Open Roadmap Question 10 w `context/foundation/roadmap.md`). Do jej rozstrzygnięcia S-03 nie może działać na
obecnej platformie.

## Endpointy i jednostki

| Źródło   | Endpoint                                                            | Promień                    |
| -------- | ------------------------------------------------------------------- | -------------------------- |
| adsb.fi  | `GET https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` | mile morskie, maks. 250 nm |
| adsb.lol | `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}`                | mile morskie, maks. 250 nm |

Odpowiedź obu: `{ ac: [...], now, total, … }`. Ustawienia trzymają promień w km. Klient przelicza go jako
`Math.min(250, Math.ceil(km / 1.852))`, czyli zaokrągla w górę, żeby obszar nigdy nie był mniejszy od ustawionego.
Klient wysyła nagłówek `User-Agent: nad-glowa (+https://nad-glowa.mateusz-kosciolko-321.workers.dev)` i ma
timeout 10 s.

## Mapowanie pól na `AircraftState`

| Pole źródła | `AircraftState` | Uwagi                                                                         |
| ----------- | --------------- | ----------------------------------------------------------------------------- |
| `hex`       | `hex`           | małe litery; wymagane (bez niego wpis trafia do `skipped`)                    |
| `lat`/`lon` | `lat`/`lon`     | wymagane liczby; bez nich wpis trafia do `skipped`                            |
| `t`         | `type`          | `trim` + `toUpperCase`; pusty → `null`                                        |
| `r`         | `registration`  | pusty → `null`                                                                |
| `flight`    | `callsign`      | `trim`; pusty → `null`                                                        |
| `track`     | `trackDeg`      | stopnie                                                                       |
| `gs`        | `groundSpeedKt` | węzły                                                                         |
| `alt_baro`  | `onGround`      | `true`, gdy `alt_baro === "ground"` (w powietrzu to liczba)                   |
| `dbFlags`   | `military`      | `(dbFlags & 1) === 1`                                                         |
| `seen_pos`  | `positionAgeS`  | sekundy od ostatniej pozycji                                                  |
| `desc`      | —               | tylko adsb.fi, czytelna nazwa typu; niemapowane, kandydat na słownik dla S-06 |

Klient nie filtruje po typie, stanie „na ziemi” ani wieku pozycji. Zwraca surowy stan, a filtrowanie należy do S-03.

## Flaga wojskowa (druga połowa Open Question 2)

- Flaga to `dbFlags & 1`. Znaczenie potwierdził research na `https://api.adsb.lol/v2/mil`, który zwraca wyłącznie
  wpisy z tym bitem.
- W pomiarze (6 próbek wokół Warszawy) nie było ani jednego samolotu wojskowego w żadnym źródle. To nie mówi nic
  o zasięgu flagi, tylko o ruchu w tym oknie.
- Zastrzeżenie z FR-007: flaga obejmuje wyłącznie samoloty widoczne w danych publicznych. Maszyny, które nie
  nadają ADS-B albo są odfiltrowane u źródła, nie pojawią się wcale. FR-007 jest odłożone (`## Parked` w roadmapie).

## Limity i warunki

| Źródło   | Limit                                                                   | Warunki                                                                               |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| adsb.fi  | 1 zapytanie na sekundę; nadmiar odpowiedzi 4xx grozi czasową blokadą IP | tylko użytek niekomercyjny; obowiązek podania adsb.fi jako źródła z linkiem do strony |
| adsb.lol | „dynamiczny”, bez podanej liczby; zapowiedziany obowiązkowy klucz API   | licencja ODbL 1.0 (też wymaga informacji o źródle)                                    |

Atrybucja jest wdrożona: stopka „Aircraft data: adsb.fi” z linkiem do `https://adsb.fi` na każdej stronie
(`src/layouts/Layout.astro`, dane z `ADSB_SOURCES[DEFAULT_ADSB_SOURCE]`, więc podąża za zmianą źródła domyślnego).

## Wyniki pomiaru

Uruchomienie 2026-09-28, 11:13–11:40 UTC, `npm run adsb:measure` z sieci lokalnej (nie z IP Cloudflare).
Punkt domyślny 52.23, 21.01 (centrum Warszawy), promień 100 km = 54 nm, 6 próbek co 300 s, do 10 zapytań o trasę
na próbkę. Odsetki dotyczą samolotów w powietrzu (z pozycją i bez `alt_baro === "ground"`).

| Źródło   | Próbki OK | Czas śr. [ms] | ac śr. | W powietrzu śr. | `t` niepuste | `t` zgodne z wzorcem | `r`   | `flight` | `track`/`gs` | Wojskowe | `hex ~` | `seen_pos` med / max [s] |
| -------- | --------- | ------------- | ------ | --------------- | ------------ | -------------------- | ----- | -------- | ------------ | -------- | ------- | ------------------------ |
| adsb.fi  | 6/6       | 99            | 31.8   | 22.7            | 94.9%        | 100.0%               | 94.9% | 99.3%    | 97.8%        | 0        | 0       | 0.299 / 50.563           |
| adsb.lol | 6/6       | 161           | 31.7   | 21.7            | 80.0%        | 100.0%               | 80.0% | 100.0%   | 94.6%        | 0        | 0       | 0.28 / 43.955            |

- `hex` obecne u 100% wpisów w obu źródłach. Kodów typów spoza wzorca `^[A-Z0-9]{2,4}$` nie było.
- Próg (typ u ≥ 90% samolotów w powietrzu i ≥ 95% zgodnych ze wzorcem): adsb.fi spełnia, adsb.lol nie spełnia
  pokrycia typu (80,0%). Brak typu w adsb.lol to samoloty bez wpisu w bazie maszyn, nie błąd formatu.
- Sonda z sieci lokalnej (faza 2, promień 30 km): adsb.fi HTTP 200, 18 samolotów (16 z typem), 107 ms;
  adsb.lol HTTP 200, 16 samolotów (13 z typem), 147 ms. Odpowiedzi bez współrzędnych, `?source=foo` → 400,
  konto bez domu → 409.

## Dostępność z produkcji

Worker `nad-glowa`, plan Cloudflare Workers Free, 2026-09-28. Sondę wywoływał zalogowany użytkownik:
`GET /api/adsb/probe` (adsb.fi) i `GET /api/adsb/probe?source=adsb.lol`.

| Wdrożenie               | Version ID                             | Źródło   | Wynik                                     |
| ----------------------- | -------------------------------------- | -------- | ----------------------------------------- |
| 1: sonda + stopka       | `f3e7fff6-07a7-43f6-aadd-5a84afd8a9ac` | adsb.fi  | `ok: false`, HTTP 403, 4 ms               |
| 1: sonda + stopka       | `f3e7fff6-07a7-43f6-aadd-5a84afd8a9ac` | adsb.lol | `ok: false`, HTTP 429, 161 ms             |
| 2: diagnostyka upstream | `67f7e569-9798-4a5b-b236-e448d39db000` | adsb.fi  | 3/3 × HTTP 403 w 5–10 ms                  |
| 2: diagnostyka upstream | `67f7e569-9798-4a5b-b236-e448d39db000` | adsb.lol | 3/3 × HTTP 429 w ~120–137 ms przez ~3 min |

Wdrożenie 2 dodało do błędu sondy pole `upstream: { server, cfRay, retryAfter, bodyStart }` dla odpowiedzi innych
niż 2xx. Wywołania szły co około minutę, po trzy na źródło. Anonimowe checki przeszły: `/api/adsb/probe` → 302 na
`/auth/signin`, `/` → 200, stopka z linkiem w HTML.

**Zaobserwowane (fakty):**

- adsb.fi: `server: cloudflare`, `cf-ray` z końcówką `-WAW`, brak `Retry-After`. Ciało to standardowa strona
  blokady/błędu Cloudflare w HTML. Odpowiedź przychodzi w 5–10 ms, czyli z brzegu Cloudflare, bez udziału serwera
  źródła.
- adsb.fi: ten sam kod i ten sam `User-Agent` dostają HTTP 200 z maszyny lokalnej (pomiar z fazy 1 i sonda
  z fazy 2).
- adsb.lol: przed źródłem stoi Cloudflare (`server: cloudflare`), ale ciało to `429 Too Many Requests … nginx`,
  czyli limit serwera nginx źródła, nie Cloudflare. Brak `Retry-After`. Stan nie zmienił się przez ~3 minuty.
- adsb.lol: z maszyny lokalnej ten sam kod dostaje HTTP 200.

**Interpretacja (hipoteza, niepotwierdzona u dostawców):**

- adsb.fi blokuje żądania wychodzące z Cloudflare Workers regułą na brzegu swojej strefy Cloudflare. Możliwy
  mechanizm: podżądania z Workerów niosą nagłówek `CF-Worker`, po którym właściciel strefy może je filtrować.
- adsb.lol limituje po adresie IP, a Workery wychodzą ze współdzielonych adresów Cloudflare. Limit jest
  wyczerpany przez innych użytkowników tych adresów, więc z Workerów źródło jest w praktyce bezużyteczne.

Zmiana `DEFAULT_ADSB_SOURCE` na adsb.lol (reguła zapasowa z planu) nic nie daje, bo odmawiają oba źródła.

## Odrzucone źródła

| Źródło          | Powód                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| OpenSky Network | brak typu samolotu w wektorze stanu; 400 kredytów dziennie bez konta; doniesienia o blokowaniu IP chmurowych |
| airplanes.live  | HTTP 403; dostęp tylko po zgodzie mailowej                                                                   |
| ADS-B Exchange  | brak darmowego API od 2025-03                                                                                |

## Research alternatyw (2026-09-28)

Szukane: źródło, które działa z Cloudflare Workers i daje typ samolotu przy biegu co minutę (~43 200 zapytań
miesięcznie). Testy curlem szły z sieci lokalnej, nie z Workera.

| Źródło                       | Wynik / warunki                                                                                           | Werdykt                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| OpenSky Network              | lokalnie HTTP 200 anonimowo (400 kredytów/dzień; z kontem OAuth2 4000, mały obszar = 1 kredyt); brak typu | celowo blokuje adresy chmurowe, bez wyjątków; tylko z domu |
| adsb.one                     | HTTP 403 (strona blokady Cloudflare) także lokalnie                                                       | odpada                                                     |
| theairtraffic                | `api.theairtraffic.com` nie rozwiązuje się w DNS                                                          | odpada                                                     |
| airplanes.live               | HTTP 403 z prośbą o maila z opisem projektu                                                               | możliwe po zgodzie mailowej                                |
| ADSB IQ                      | API zgodne z adsb.lol, ale tylko dla feederów (autoryzacja po IP feedera)                                 | wymaga własnego odbiornika (PRD Non-Goals)                 |
| ADS-B Exchange (RapidAPI)    | 10 USD/mies., 10 000 zapytań, niekomercyjnie                                                              | starcza na bieg co ~5 min, co łamie NFR < 60 s             |
| Flightradar24 API (Explorer) | 9 USD/mies., 30 000 kredytów; 6 kredytów za każdy zwrócony samolot                                        | ~250 zapytań/mies. przy ~20 samolotach; odpada             |
| AirLabs                      | darmowo 1000 zapytań/mies.; 10 tys. za 19 USD; opóźnienie danych nieudokumentowane                        | limit za mały                                              |
| adsbdb `/v0/aircraft/{hex}`  | działa, ale zna tylko część maszyn (`48ad10` → „unknown aircraft”)                                        | tylko uzupełnianie braków typu                             |

- Blokada dotyczy Cloudflare, nie hostingu w ogóle: zgłoszenie
  `github.com/georgekobaidze/metal-birds-watch/issues/98` opisuje przejście z OpenSky na adsb.fi / adsb.lol /
  airplanes.live z backendu na Railway.
- adsb.fi (`github.com/adsbfi/opendata`) zaprasza do kontaktu przy wyższych wymaganiach co do limitu.

**Decyzja (2026-09-28):** na razie pobieranie ADS-B i zadanie cykliczne działają lokalnie, z sieci
użytkownika, na adsb.fi (zapas adsb.lol). Wdrożenie na serwer jest odłożone (`## Parked` w roadmapie).

## Trasy (odpowiedź dla S-07)

- Żadne ze źródeł z F-01 nie daje trasy w odpowiedzi `point`.
- adsb.lol `POST /api/0/routeset` z 10 samolotami (`{callsign, lat, lng}`) zwraca HTTP 201 z pustym ciałem,
  w pomiarze tak samo jak w researchu. W tej postaci nie dostarcza tras.
- **adsbdb** (`GET https://api.adsbdb.com/v0/callsign/{callsign}`, bez klucza, limit nieopublikowany): 37 z 60
  znaków wywoławczych z trasą (61,7%), 60/60 odpowiedzi bez odmów, średnio 42 ms.
- Wniosek: S-07 potrzebuje adsbdb jako drugiego źródła. Około 4 na 10 alertów zostanie z „trasa nieznana”.
- Dostępność adsbdb z Cloudflare Workers **nie była testowana**. Pomiar szedł z sieci lokalnej.

## Wskazówki dla S-03

- **Pobieranie idzie lokalnie, z sieci użytkownika.** Z Workera oba źródła odmawiają; Open Roadmap Question 10
  rozstrzygnięte 2026-09-28 na korzyść uruchamiania lokalnego.
- Jedno zapytanie na użytkownika na bieg. Limit adsb.fi to 1 req/s, więc przy wielu użytkownikach zapytania idą
  sekwencyjnie albo łączą się w jedno większe koło.
- Nie generować odpowiedzi 4xx (błędne URL-e, powtórki po odmowie). U adsb.fi grożą blokadą IP.
- Promień w km przeliczać na nm (klient robi to sam, przez `fetchAircraftNear`).
- Dla prywatności można pytać o zgrubniejszy punkt z zapasem promienia i zawężać wynik lokalnie. Zapytanie
  i tak zawiera przybliżoną lokalizację domu (~1 km).
- Odfiltrować samoloty na ziemi (`onGround`). Sonda widziała wpis typu `TWR` z rejestracją `TWR` (wieża albo
  stacja naziemna lotniska). Pasuje do wzorca kodu typu, ale stoi na ziemi.
- Uwzględniać wiek pozycji (`positionAgeS`) przy predykcji. Mediana jest poniżej 0,3 s, ale zdarzają się wpisy
  sprzed ~50–60 s. Przy 450 kt to kilkanaście kilometrów.
- `desc` z adsb.fi (opcjonalne) to kandydat na czytelne nazwy typów dla S-06.
- `hex` z prefiksem `~` to adres spoza ICAO (TIS-B). W pomiarze 0 takich wpisów, ale S-04 nie powinien
  deduplikować po takim `hex`.

## Otwarte ryzyka

- **Blokada Cloudflare Workers — zmaterializowane.** adsb.fi 403, adsb.lol 429 z produkcji. Zob. „Co dalej”.
- **Zapowiedziany obowiązkowy klucz API w adsb.lol.** Zapas może wymagać rejestracji w nieznanym terminie.
- **Brak SLA.** Oba źródła są darmowe i społecznościowe. Warunki i dostępność mogą się zmienić bez uprzedzenia.
- **Blokada IP przy nadmiarze 4xx w adsb.fi.** Dotyczy każdego przyszłego środowiska pollera, także współdzielonych
  adresów innych chmur.
- **Pokrycie typu w adsb.lol: 80,0% < 90%.** Po przełączeniu na zapas około 1 na 5 samolotów w powietrzu zostanie
  pominięty przez regułę typów.

## Co dalej

- Open Roadmap Question 10 rozstrzygnięte 2026-09-28: F-02 i S-03 działają lokalnie, z sieci użytkownika.
- Kierunki na wdrożenie produkcyjne, **odłożone** (`## Parked` w roadmapie):
  - mały poller poza Cloudflare, który zapisuje stan samolotów do Supabase, a Worker czyta go z bazy. Railway
    jest drugim wyborem w `context/foundation/infrastructure.md`, ale jego cron ma minimum 5 minut, więc poller
    co minutę byłby stale działającą usługą;
  - prośba do dostawców o dostęp z Workerów (adsb.fi) albo o klucz z własnym limitem (adsb.lol).
- Sonda `/api/adsb/probe` z diagnostyką `upstream` zostaje. Służy do ponownego testu każdego nowego środowiska,
  zanim zbuduje się na nim S-03.
