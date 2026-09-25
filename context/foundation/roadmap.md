---
project: "Nad Głową"
version: 1
status: draft
created: 2026-09-25
updated: 2026-09-25
prd_version: 1
main_goal: speed
top_blocker: decisions
milestone_id: first-advance-alert-mvp
milestone_seq: 1
milestone_status: open
---

# Roadmap: Nad Głową

> Źródła: `context/foundation/prd.md` (v1), `tech-stack.md`, `infrastructure.md`, `context/deployment/deploy-plan.md` oraz automatycznie zbadany stan kodu.
> Edytuj w miejscu; archiwizuj, gdy zostanie zastąpiona.
> Elementy poniżej są w kolejności zależności. Tabela „At a glance” jest indeksem.

## Milestone

**M-1: Pierwszy alert nad domem** — Status: open

- **Intent:** Zaproszony użytkownik ustawia lokalizację domu, promień i typy samolotów, a potem dostaje powiadomienie co najmniej 2 minuty przed przelotem pasującego samolotu. Powiadomienie przychodzi raz na maszynę i da się je wstrzymać. Kamień milowy obejmuje całą ścieżkę wymagań, które PRD oznacza jako must-have.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** każdy F-NN i S-NN poniżej ma status `done`.
- **Scope anchors:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-009, FR-010; US-01; NFR (powiadomienie < 60 s); Access Control. Poza zakresem są FR-007, FR-008 i FR-011 (zob. `## Parked`).

## Vision recap

Obserwator z balkonu dowiaduje się o nietypowym samolocie (wojskowym, ciężkim transportowcu) dopiero wtedy, gdy ten jest już nad głową, czyli za późno, żeby wyjść z lornetką. Istniejące narzędzia to mapy, na które trzeba patrzeć, a nie powiadomienie, które przychodzi samo. Do tego „ciekawy” jest pojęciem osobistym. Użyteczny alert musi przyjść 2–15 minut _przed_ przelotem nad domem konkretnego użytkownika.

## North star

**S-03: Użytkownik dostaje powiadomienie o pasującym samolocie co najmniej 2 minuty przed przelotem** — to wprost główne kryterium sukcesu PRD, więc stoi tak wcześnie, jak pozwalają zależności.

> North star (gwiazda przewodnia) to najmniejszy kawałek dowieziony od początku do końca, którego działanie dowodzi głównej hipotezy produktu. Wszystko inne ma sens tylko wtedy, gdy on działa, dlatego nie jest odkładany dla porządku.

## At a glance

| ID   | Change ID             | Outcome (user can …)                                                                       | Prerequisites    | PRD refs                               | Status   |
| ---- | --------------------- | ------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------- | -------- |
| F-01 | adsb-source-verified  | (foundation) wybrane darmowe źródło ADS-B potwierdzone jako dające typ, pozycję i kurs     | —                | Open Question 2, Business Logic        | ready    |
| F-02 | minute-cron-heartbeat | (foundation) zadanie cykliczne działa co minutę na produkcji i zostawia ślad każdego biegu | —                | NFR (< 60 s)                           | ready    |
| S-01 | invite-only-access    | niezalogowany widzi wyłącznie logowanie; konto zakłada się tylko ręcznie                   | —                | FR-001, Access Control                 | ready    |
| S-02 | alert-settings-basic  | zapisać przybliżoną lokalizację domu, promień i listę typów samolotów                      | —                | FR-003, FR-004, FR-005, Access Control | ready    |
| S-03 | first-advance-alert   | dostać powiadomienie ≥ 2 min przed przelotem pasującego samolotu                           | F-01, F-02, S-02 | US-01, FR-009, NFR (< 60 s)            | blocked  |
| S-04 | no-repeat-alerts      | nie dostać drugiego powiadomienia o tej samej maszynie w oknie deduplikacji                | S-03             | FR-010, US-01                          | blocked  |
| S-05 | pause-resume-alerts   | wstrzymać i wznowić alerty                                                                 | S-03             | FR-006                                 | proposed |
| S-06 | aircraft-type-picker  | wybrać typy z krótkiej listy z czytelnymi nazwami i wyszukać w pełnej liście               | F-01, S-02       | FR-002, FR-005                         | proposed |
| S-07 | route-in-alerts       | zobaczyć w alercie o samolocie cywilnym skąd i dokąd leci                                  | S-03             | FR-009, US-01                          | proposed |

## Streams

Pomoc nawigacyjna: grupuje elementy ze wspólnym łańcuchem zależności. Kanoniczna kolejność to graf zależności poniżej; ta tabela to proponowana kolejność czytania równoległych ścieżek.

| Stream | Theme             | Chain                             | Note                                                                                                 |
| ------ | ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A      | Dane i alert      | `F-01` → `S-03` → `S-04` → `S-07` | Oś celu `speed`: najkrótsza droga do pierwszego alertu; tu łączą się strumienie B i C (przy `S-03`). |
| B      | Zadanie cykliczne | `F-02`                            | Dołącza do strumienia A przy `S-03`; może iść równolegle z `F-01` od pierwszego dnia.                |
| C      | Ustawienia        | `S-02` → `S-06` → `S-05`          | `S-02` zasila A przy `S-03`; `S-05` wymaga już działającego `S-03`.                                  |
| D      | Dostęp            | `S-01`                            | Samodzielny; bez zależności, może wejść w dowolnym momencie.                                         |

## Baseline

Co już jest w kodzie na dzień 2026-09-25 (zbadane automatycznie i potwierdzone przez użytkownika). Poniższe fundamenty zakładają, że te elementy istnieją, i nie budują ich od nowa.

- **Frontend:** present — Astro 7 SSR z wyspami React, Tailwind i shadcn; strony `src/pages/index.astro`, `src/pages/dashboard.astro` (pusta), formularze w `src/components/auth/`.
- **Backend / API:** partial — wyłącznie endpointy auth w `src/pages/api/auth/`; brak handlera zadania cyklicznego i brak crona w `wrangler.jsonc`.
- **Data:** absent — jest `supabase/config.toml`, brak migracji. Schemat ustawień alertów z izolacją per użytkownik jest zaprojektowany (`aba254e`) i zaplanowany (`511ba0a`), ale niewdrożony.
- **Auth:** partial — logowanie e-mailem i hasłem działa na produkcji (`src/pages/api/auth/signin.ts`, `src/middleware.ts`). Rejestracja `/auth/signup` jest jednak otwarta, a `PROTECTED_ROUTES` obejmuje tylko `/dashboard`; oba punkty są niezgodne z Access Control w PRD.
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`, `preview_urls: false`), CI: lint → `astro check` → build + smoke na lokalnej bazie. Nie wdrożono: planu Workers Paid (wymaganego dla crona), remote'a i auto-deployu, pola `site`.
- **Observability:** partial — Workers Logs włączone (`observability.enabled: true`); brak śledzenia błędów i brak heartbeatu crona.

## Foundations

### F-01: Zweryfikowane źródło danych ADS-B

- **Outcome:** (foundation) wybrane darmowe publiczne źródło ADS-B jest potwierdzone empirycznie: dla obszaru wokół domu zwraca typ samolotu, identyfikator maszyny, pozycję, kurs i prędkość, jest osiągalne ze środowiska produkcyjnego aplikacji, a decyzja wraz z limitami i warunkami użycia jest zapisana.
- **Change ID:** adsb-source-verified
- **PRD refs:** Open Question 2, Business Logic (wejścia predykcji), Non-Goals (brak własnego odbiornika)
- **Unlocks:** S-03, S-06; rozstrzyga Open Roadmap Question 2 (Block: yes dla FR-002/FR-009)
- **Prerequisites:** —
- **Parallel with:** F-02, S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - Czy źródło podaje też trasę (skąd/dokąd)? — Owner: user. Block: no. Odpowiedź przesądza, czy S-07 potrzebuje drugiego źródła.
- **Risk:** Stoi na początku, bo bez typu samolotu w danych reguła biznesowa w ogóle nie działa. Jeśli żadne darmowe źródło tego nie daje, cały kamień milowy wymaga rewizji PRD, a lepiej to wiedzieć, zanim powstanie reszta.
- **Status:** ready

### F-02: Zadanie cykliczne co minutę z heartbeatem

- **Outcome:** (foundation) zadanie cykliczne uruchamia się co minutę na produkcji i przy każdym biegu, także pustym, zapisuje ślad (czas biegu), więc cisza „brak ciekawych samolotów” jest odróżnialna od ciszy „zadanie przestało działać”.
- **Change ID:** minute-cron-heartbeat
- **PRD refs:** NFR (< 60 s)
- **Unlocks:** S-03 (ścieżka weryfikacji: dowód, że zadanie żyje, zanim zaczniemy ufać braku alertów)
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02
- **Blockers:** Włączenie planu Cloudflare Workers Paid (5 USD/mies.) — decyzja rozliczeniowa wykonywana ręcznie przez człowieka, zgodnie z granicą dostępu z `infrastructure.md`.
- **Unknowns:** —
- **Risk:** Rejestr ryzyk w `infrastructure.md` ocenia cichą awarię crona na M/H; heartbeat jest najtańszym zabezpieczeniem i musi istnieć, zanim pierwszy alert stanie się sygnałem, na którym polegamy.
- **Status:** ready

## Slices

### S-01: Dostęp tylko dla zaproszonych

- **Outcome:** użytkownik niezalogowany widzi wyłącznie ekran logowania, a każda inna trasa przekierowuje do logowania; nie da się samodzielnie założyć konta, konta dodaje się ręcznie.
- **Change ID:** invite-only-access
- **PRD refs:** FR-001, Access Control
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-02, S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Metoda logowania (Open Roadmap Question 5) — Owner: user. Block: no. Logowanie e-mailem i hasłem już działa na produkcji; brak decyzji oznacza jego utrzymanie.
  - Czym zastąpić obecny test smoke, który w każdym biegu zakłada konto przez otwartą rejestrację? — Owner: team. Block: no.
- **Risk:** Zamknięcie rejestracji odcina ścieżkę, na której opiera się jedyny test automatyczny, więc zmiana musi dostarczyć nową ścieżkę weryfikacji, a nie tylko usunąć formularz.
- **Status:** ready

### S-02: Podstawowe ustawienia alertów

- **Outcome:** zalogowany użytkownik może zapisać i zmienić przybliżoną lokalizację domu (~1 km), promień obserwacji (wstępnie wypełniony wartością domyślną) i listę typów samolotów, a inni użytkownicy nigdy tych danych nie widzą.
- **Change ID:** alert-settings-basic
- **PRD refs:** FR-003, FR-004, FR-005, Access Control
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-01
- **Blockers:** —
- **Unknowns:**
  - Domyślny promień (Open Roadmap Question 6) — Owner: user. Block: no. Zatwierdzony spec `aba254e` przyjmuje 30 km; wystarczy to potwierdzić.
- **Risk:** Lista typów jest tu w najprostszej postaci (kody typów), żeby nie czekać na F-01. Czytelny wybór to S-06. Jeśli F-01 pokaże, że źródło raportuje typy inaczej niż standardowe kody, S-03 będzie potrzebował mapowania.
- **Status:** ready

### S-03: Pierwszy alert przed przelotem

- **Outcome:** użytkownik dostaje powiadomienie o samolocie wybranego typu, który według predykcji przeleci w jego promieniu za 2–15 minut, najpóźniej 60 s po pojawieniu się warunku w danych. Powiadomienie zawiera typ, rejestrację, przewidywany czas, kierunek nadlotu i „trasa nieznana”. Przy wykryciu później niż 2 minuty przed przelotem przychodzi z oznaczeniem „już blisko”.
- **Change ID:** first-advance-alert
- **PRD refs:** US-01, FR-009, NFR (< 60 s)
- **Prerequisites:** F-01, F-02, S-02
- **Parallel with:** S-01, S-06
- **Blockers:** —
- **Unknowns:**
  - Kanał powiadomień: Telegram czy e-mail (Open Roadmap Question 3)? — Owner: user. Block: yes. `infrastructure.md` wskazuje Telegram (jedno wywołanie HTTPS; środowisko nie ma SMTP).
- **Risk:** Bez S-04 ta sama maszyna może wywoływać alert przy każdym biegu zadania, więc S-03 służy do walidacji, a nie do codziennego używania. S-04 musi wejść zaraz po nim.
- **Status:** blocked

### S-04: Bez powtórzonych alertów

- **Outcome:** użytkownik nie dostaje drugiego powiadomienia o tej samej maszynie (ten sam adres transpondera lub rejestracja, niezależnie od znaku wywoławczego) w oknie deduplikacji.
- **Change ID:** no-repeat-alerts
- **PRD refs:** FR-010, US-01
- **Prerequisites:** S-03
- **Parallel with:** S-01, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Długość okna deduplikacji (Open Roadmap Question 4) — Owner: user. Block: yes.
- **Risk:** To zabezpieczenie „bez spamu” z PRD; dopóki go nie ma, produkt nie nadaje się do używania na co dzień, więc ma pierwszeństwo przed pozostałymi elementami po S-03.
- **Status:** blocked

### S-05: Wstrzymanie i wznowienie alertów

- **Outcome:** użytkownik może wstrzymać alerty (np. na urlop lub noc) i je wznowić; w czasie pauzy nie dostaje powiadomień, a ustawienia pozostają nietknięte.
- **Change ID:** pause-resume-alerts
- **PRD refs:** FR-006
- **Prerequisites:** S-03
- **Parallel with:** S-01, S-04, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Darmowy projekt bazy usypia się po 7 dniach bezczynności (`infrastructure.md`), więc pauza nie może zatrzymywać zadania cyklicznego, tylko samo wysyłanie; inaczej alerty po urlopie nie wrócą.
- **Status:** proposed

### S-06: Czytelny wybór typów samolotów

- **Outcome:** użytkownik wybiera typy z krótkiej listy wyróżnionych „ciekawych” typów z czytelnymi nazwami, a poniżej może wyszukać w pełnej liście typów.
- **Change ID:** aircraft-type-picker
- **PRD refs:** FR-002, FR-005
- **Prerequisites:** F-01, S-02
- **Parallel with:** S-01, S-03, S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Skąd pochodzi pełna lista typów z czytelnymi nazwami i kto wybiera listę wyróżnionych? — Owner: user. Block: no.
- **Risk:** Stoi po F-01, bo słownik typów musi zgadzać się z tym, co raportuje źródło danych; pełna lista nie może być wczytywana przy starcie aplikacji (limit czasu startu, `infrastructure.md`).
- **Status:** proposed

### S-07: Trasa w alercie

- **Outcome:** w alercie o samolocie cywilnym użytkownik widzi lotnisko wylotu i celu, gdy są znane; brak trasy nigdy nie opóźnia ani nie blokuje powiadomienia.
- **Change ID:** route-in-alerts
- **PRD refs:** FR-009, US-01
- **Prerequisites:** S-03
- **Parallel with:** S-01, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Czy trasę daje źródło z F-01, czy potrzebne jest osobne źródło wyszukujące po znaku wywoławczym? — Owner: user. Block: no. Rozstrzyga się przy F-01.
- **Risk:** Wydzielone z S-03, bo PRD dopuszcza „trasa nieznana”, a osobne źródło trasy to druga zależność zewnętrzna; wpięcie go w pierwszy alert niepotrzebnie wydłużyłoby drogę do walidacji.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID             | Suggested issue title                            | Ready for `/10x-plan` | Notes                                                                                                      |
| ---------- | --------------------- | ------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| F-01       | adsb-source-verified  | Zweryfikuj darmowe źródło ADS-B z typem samolotu | yes                   | Run `/10x-plan adsb-source-verified`                                                                       |
| F-02       | minute-cron-heartbeat | Uruchom zadanie co minutę z heartbeatem          | yes                   | Wymaga ręcznego włączenia Workers Paid; granica klucza serwisowego z planu `511ba0a` (Task 2) należy tutaj |
| S-01       | invite-only-access    | Zamknij rejestrację i chroń wszystkie trasy      | yes                   | Run `/10x-plan invite-only-access`; zastąp ścieżkę testu smoke                                             |
| S-02       | alert-settings-basic  | Ustawienia alertów: dom, promień, typy           | yes                   | Część danych pokrywają spec `aba254e` i plan `511ba0a` (Task 1); rozszerzyć o ekran ustawień               |
| S-03       | first-advance-alert   | Pierwszy alert przed przelotem nad domem         | no                    | Blokuje wybór kanału (Q3) oraz F-01, F-02, S-02                                                            |
| S-04       | no-repeat-alerts      | Deduplikacja alertów po maszynie                 | no                    | Blokuje długość okna (Q4) oraz S-03                                                                        |
| S-05       | pause-resume-alerts   | Pauza i wznowienie alertów                       | no                    | Czeka na S-03                                                                                              |
| S-06       | aircraft-type-picker  | Wybór typów z czytelnymi nazwami i wyszukiwaniem | no                    | Czeka na F-01 i S-02                                                                                       |
| S-07       | route-in-alerts       | Trasa (skąd/dokąd) w alercie                     | no                    | Czeka na S-03; źródło trasy wyjaśnia F-01                                                                  |

## Open Roadmap Questions

1. **Czy istniejące płatne alerty (Flightradar24 lub podobne) już rozwiązują ten problem?** — Owner: user. Block: roadmap-wide. PRD każe sprawdzić to przed budową; przy celu `speed` najtaniej zrobić to przed S-03.
2. **Które darmowe publiczne źródło ADS-B podaje typ samolotu i flagę wojskową?** — Owner: user. Block: F-01 (rozstrzyga je), S-03, S-06.
3. **Kanał powiadomień: Telegram czy e-mail?** — Owner: user. Block: S-03.
4. **Długość okna deduplikacji?** — Owner: user. Block: S-04.
5. **Metoda logowania (e-mail + hasło, OAuth, magic link)?** — Owner: user. Block: — (S-01 zakłada utrzymanie działającego e-maila z hasłem).
6. **Domyślna wartość promienia?** — Owner: user. Block: — (S-02 przyjmuje 30 km ze zatwierdzonego spec).
7. **Skala docelowa: wolumen zapytań i danych?** — Owner: user. Block: — (wpływa na budżet zapytań na jeden bieg zadania, ryzyko z `infrastructure.md`).
8. **Czy dziennik obserwacji jest zapisywany w MVP, choć jego przeglądanie (FR-011) jest odłożone?** — Owner: user. Block: — w tym kamieniu milowym; od odpowiedzi zależy drugorzędne kryterium sukcesu.
9. **Czy MVP ma zawierać kolekcję rekordów zarządzaną przez użytkownika?** — Owner: user. Block: — w tym kamieniu milowym (kandydaci FR-008, FR-011 są odłożeni).

## Parked

- **Flaga „interesują mnie samoloty wojskowe” (FR-007)** — Why parked: PRD Non-Goals, nice-to-have.
- **Wiele reguł alertów (FR-008)** — Why parked: PRD Non-Goals, nice-to-have.
- **Przeglądanie dziennika obserwacji (FR-011)** — Why parked: PRD Non-Goals, nice-to-have; kandydat na kolejny kamień milowy razem z pytaniem 8.
- **Wybór kanału powiadomień przez użytkownika** — Why parked: PRD Non-Goals, jeden stały kanał w MVP.
- **Własny odbiornik ADS-B, funkcje dla spotterów, gwarancja kompletności, tryb „wszystkie samoloty”** — Why parked: PRD Non-Goals.
- **Auto-deploy z GitHub Actions** — Why parked: repo nie ma remote'a (`deploy-plan.md`); przy celu `speed` ręczny `wrangler deploy` wystarcza.
- **Własna domena i pole `site`** — Why parked: `deploy-plan.md`, nie wpływa na żaden wymóg PRD.
- **Śledzenie błędów poza heartbeatem** — Why parked: cel `speed`; heartbeat z F-02 pokrywa ryzyko cichej awarii, a Workers Logs resztę.

## Milestone History

## Done
