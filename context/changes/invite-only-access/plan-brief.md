# Dostęp tylko dla zaproszonych (S-01) — Plan Brief

> Full plan: `context/changes/invite-only-access/plan.md`

## What & Why

Aplikacja przechowuje przybliżoną lokalizację domu, więc PRD wymaga, żeby niezalogowany widział wyłącznie ekran
logowania, a konta zakładał tylko administrator. Dziś rejestracja jest otwarta (także na produkcji), a middleware
chroni tylko wybrane trasy.

## Starting Point

Middleware ma listę chronionych prefiksów (`/dashboard`, `/settings`, `/api/settings`, `/api/adsb`). `/` to landing
startera z „Sign Up”. Istnieją strony i endpoint rejestracji. Smoke zakłada konto przez rejestrację i od niego
zależą wszystkie kroki po zalogowaniu. Lokalna i produkcyjna Supabase przyjmują `signUp`.

## Desired End State

Każda trasa poza logowaniem przekierowuje anonima do `/auth/signin`; zalogowany z `/` trafia na dashboard. Kodu
rejestracji nie ma, a Supabase (lokalnie i na produkcji) odrzuca `signUp`. Smoke zakłada konto przez Admin API
lokalnej Supabase, sprawdza zamkniętą rejestrację i usuwa konto. Produkcja działa na nowym kodzie.

## Key Decisions Made

| Decision              | Choice                                                       | Why (1 sentence)                                                               |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Konto dla smoke       | Admin API lokalnej Supabase, usuwane po biegu                | Świeże konto co bieg, ta sama droga co konto z panelu, bez kruchego seeda SQL. |
| Bezpieczeństwo klucza | Smoke odmawia działania, gdy `SUPABASE_URL` nie jest lokalny | Klucz `service_role` w skrypcie nie może nigdy dotknąć produkcji.              |
| Strona `/`            | Przekierowanie: anonim → logowanie, zalogowany → dashboard   | Dosłownie spełnia PRD i usuwa jedyny publiczny widok z „Sign Up”.              |
| Kod rejestracji       | Usunięty całkiem + `enable_signup = false`                   | Dwie warstwy zamknięcia, brak martwego kodu.                                   |
| Model ochrony tras    | `PUBLIC_ROUTES` (domyślnie zamknięte)                        | Nowa trasa jest prywatna, dopóki ktoś świadomie jej nie otworzy.               |
| Produkcja             | W tej zmianie: `db push` → przełącznik w panelu → deploy     | Otwarta rejestracja na produkcji to realne ryzyko z PRD.                       |
| Metoda logowania      | Bez zmian (e-mail + hasło)                                   | Open Roadmap Question 5: brak decyzji oznacza utrzymanie.                      |

## Scope

**In scope:**

- Middleware z `PUBLIC_ROUTES`, przekierowanie `/`, cel po zalogowaniu `/dashboard`
- Usunięcie stron/endpointu rejestracji, `SignUpForm`, landingu (`Welcome`, `Topbar`) i linku „Sign up”
- `enable_signup = false` w `supabase/config.toml`
- Smoke z Admin API, blokadą hosta, sprzątaniem i nowymi krokami; CI z `SERVICE_ROLE_KEY`
- README i `CLAUDE.md` (reguła tras, wyjątek `service_role` dla smoke)
- Produkcja: cztery zaległe migracje, przełącznik w panelu, deploy, dokumenty

**Out of scope:**

- Zaproszenia w aplikacji, panel admina, skrypt zakładania kont
- Zmiana metody logowania, reset hasła
- Przekierowanie zalogowanego z `/auth/signin`, własna strona 404
- Cron i token Telegrama na produkcji, przebudowa wyglądu logowania

## Architecture / Approach

Middleware sprawdza sesję jak dziś, ale przepuszcza anonima tylko na trasy z `PUBLIC_ROUTES` (logowanie,
endpointy logowania i wylogowania). Supabase jest drugą warstwą: rejestracja wyłączona w konfiguracji. Smoke jest
skryptem poza `src/`: czyta `.dev.vars`, zakłada konto przez GoTrue Admin API, przechodzi przepływ HTTP i usuwa
konto w `finally`.

## Phases at a Glance

| Phase                                   | What it delivers                                                | Key risk                                                          |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Zamknięte trasy i koniec rejestracji | Lokalnie zamknięta aplikacja, nowy smoke, CI i dokumenty        | Lokalna Supabase wymaga restartu, żeby `enable_signup` zadziałało |
| 2. Produkcja                            | Migracje, rejestracja zamknięta w panelu, nowy kod na produkcji | Deploy wciąga cztery zaległe migracje                             |

**Prerequisites:** lokalna Supabase i `SUPABASE_SERVICE_KEY` w `.dev.vars` (już są); dostęp do panelu Supabase
i `wrangler` dla fazy 2.
**Estimated effort:** ~1 sesja na fazę 1, krótka sesja na fazę 2.

## Open Risks & Assumptions

- Na produkcji Admin API nie jest używane — konta zakłada się tylko w panelu; klucz `service_role` produkcji nie trafia do smoke.
- Statyczne assety (`/_astro/*`, `favicon.png`) nie przechodzą przez middleware; weryfikacja ręczna potwierdzi, że
  ekran logowania ma style.
- Stare konta `smoke-*` w lokalnej bazie zostają; można je usunąć ręcznie.

## Success Criteria (Summary)

- Anonim nie zobaczy niczego poza ekranem logowania, ani lokalnie, ani na produkcji.
- Nikt nie założy konta sam — ani przez aplikację, ani bezpośrednio przez Supabase.
- Smoke i CI dalej weryfikują pełny przepływ po zalogowaniu, nie zostawiając kont.
