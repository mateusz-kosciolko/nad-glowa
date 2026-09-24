# alert_settings + RLS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postawić pierwszą tabelę bazy — `alert_settings` — z politykami RLS, które czynią „użytkownik widzi wyłącznie swoje dane" własnością bazy, a nie konwencją w kodzie.

**Architecture:** Jedna migracja Supabase tworzy domenę `icao_type`, tabelę `alert_settings` (klucz główny = `auth.users.id`), dwie polityki RLS dla roli `authenticated`, trigger `security definer` zakładający wiersz przy tworzeniu konta oraz backfill dla kont już istniejących. Testy pgTAP sprawdzają polityki od strony bazy, w transakcji z `rollback`. Osobno powstaje reguła ESLint, która z wyprzedzeniem zamyka import przyszłego modułu z kluczem `service_role`.

**Tech Stack:** Supabase CLI 2.117.0 (lokalnie w `node_modules`), Postgres 17, pgTAP, ESLint 9 flat config, Docker Desktop.

## Global Constraints

- Precyzja lokalizacji: `numeric(5,2)` — typ wymusza zaokrąglenie, aplikacja nie zaokrągla.
- Role w politykach: wyłącznie `to authenticated`; `anon` nie ma dostępu do tej tabeli.
- `auth.uid()` zawsze opakowane w `(select auth.uid())` — InitPlan zamiast wywołania na wiersz.
- Brak polityki `insert` i brak polityki `delete` — to decyzja projektowa, nie przeoczenie.
- Funkcje `security definer` mają `set search_path = ''` i w pełni kwalifikowane nazwy.
- `SUPABASE_SERVICE_KEY` nie wchodzi do `astro.config.mjs` ani do Workers Secrets w ramach tego planu.
- Nie uruchamiać `npm run smoke` przeciwko produkcji.
- Migracje addytywne — bez `drop` na obiektach, do których odwołuje się wdrożony Worker.

Spec: `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`

---

## File Structure

| Plik                                          | Odpowiedzialność                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_alert_settings.sql` | Cały schemat: domena, tabela, grants, RLS, trigger, backfill. Jedna migracja, bo te obiekty nie mają sensu osobno |
| `supabase/tests/alert_settings_rls.sql`       | Testy pgTAP — jedyny automatyczny dowód, że polityki działają                                                     |
| `package.json`                                | Skrypt `test:db`                                                                                                  |
| `.github/workflows/ci.yml`                    | Uruchomienie testów bazy w jobie, który i tak startuje Supabase                                                   |
| `eslint.config.js`                            | Reguła zamykająca import `supabase-admin`                                                                         |
| `CLAUDE.md`                                   | Hard rule o granicy klucza serwisowego                                                                            |
| `context/deployment/deploy-plan.md`           | Korekta — dziś twierdzi, że `service_role` nigdy nie trafi do aplikacji                                           |

---

## Task 0: Bramka ręczna — Docker

Docker Desktop jest zainstalowany (`/usr/local/bin/docker`, klient 29.7.2), ale demon nie działa. Bez niego `supabase start` nie ruszy, a cała pętla testowa tego planu stoi na lokalnej bazie.

- [ ] **Step 1: Uruchom Docker Desktop**

```bash
open -a Docker
```

- [ ] **Step 2: Poczekaj, aż demon odpowiada**

```bash
for i in $(seq 1 60); do docker info >/dev/null 2>&1 && echo "READY" && break; sleep 2; done
```

Expected: `READY`. Jeśli po dwóch minutach nic — otwórz Docker Desktop ręcznie i sprawdź, czy nie czeka na akceptację licencji lub aktualizację.

- [ ] **Step 3: Wystartuj lokalne Supabase**

```bash
npx supabase start
```

Expected: lista URL-i i kluczy (`API URL`, `anon key`, `service_role key`). Pierwsze uruchomienie ciągnie obrazy — kilka minut.

---

## Task 1: Migracja, testy pgTAP, CI

**Files:**

- Create: `supabase/migrations/<timestamp>_alert_settings.sql` (nazwę generuje CLI)
- Create: `supabase/tests/alert_settings_rls.sql`
- Modify: `package.json` (sekcja `scripts`)
- Modify: `.github/workflows/ci.yml` (job `smoke`)

**Interfaces:**

- Produces: tabela `public.alert_settings` z kolumnami `user_id uuid`, `home_lat numeric(5,2)`, `home_lon numeric(5,2)`, `radius_km integer`, `aircraft_types public.icao_type[]`, `paused boolean`, `updated_at timestamptz`; domena `public.icao_type`; funkcja `public.handle_new_user()`; trigger `on_auth_user_created` na `auth.users`.
- Consumes: nic — to pierwszy obiekt bazy w tym projekcie.

- [ ] **Step 1: Utwórz pusty plik migracji**

```bash
npx supabase migration new alert_settings
```

Expected: `Created new migration at supabase/migrations/<timestamp>_alert_settings.sql`. Zapisz tę ścieżkę — kolejne kroki mówią o niej „plik migracji".

- [ ] **Step 2: Napisz test, zanim powstanie schemat**

Wpisz do `supabase/tests/alert_settings_rls.sql`:

```sql
begin;
create extension if not exists pgtap;
select plan(12);

-- ── struktura ────────────────────────────────────────────────────────
select has_table('public', 'alert_settings');

select is(
  (select relrowsecurity from pg_class where oid = 'public.alert_settings'::regclass),
  true,
  'RLS jest włączone'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'alert_settings'),
  2,
  'dokładnie dwie polityki — select i update, bez insert i delete'
);

-- ── trigger zakłada wiersz ───────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

select is(
  (select count(*)::int from public.alert_settings),
  2,
  'trigger utworzył wiersz dla każdego nowego konta'
);

select is(
  (select radius_km from public.alert_settings
    where user_id = '11111111-1111-1111-1111-111111111111'),
  30,
  'domyślny promień to 30 km (FR-004)'
);

-- ── numeric(5,2) zaokrągla, nie odrzuca (FR-003) ─────────────────────
update public.alert_settings
   set home_lat = 52.23456, home_lon = 21.01178
 where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select home_lat from public.alert_settings
    where user_id = '11111111-1111-1111-1111-111111111111'),
  52.23::numeric,
  'typ kolumny zaokrąglił szerokość do 2 miejsc'
);

-- ── ograniczenia ─────────────────────────────────────────────────────
select throws_ok(
  $$update public.alert_settings set radius_km = 0
     where user_id = '11111111-1111-1111-1111-111111111111'$$,
  '23514',
  null,
  'promień 0 łamie radius_sane'
);

select throws_ok(
  $$update public.alert_settings set aircraft_types = '{b744}'
     where user_id = '11111111-1111-1111-1111-111111111111'$$,
  '23514',
  null,
  'małe litery łamią domenę icao_type'
);

-- ── RLS oczami użytkownika A ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.alert_settings),
  1,
  'użytkownik A widzi wyłącznie swój wiersz'
);

select is(
  (select count(*)::int from public.alert_settings
    where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'wiersz użytkownika B jest niewidoczny nawet po jawnym user_id'
);

delete from public.alert_settings
 where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::int from public.alert_settings),
  1,
  'delete nie usunął niczego — brak polityki delete (FR-006)'
);

select throws_ok(
  $$insert into public.alert_settings (user_id)
     values ('33333333-3333-3333-3333-333333333333')$$,
  '42501',
  null,
  'insert odrzucony — wiersz tworzy wyłącznie trigger'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Uruchom test i upewnij się, że pada**

```bash
npx supabase test db
```

Expected: FAIL — `relation "public.alert_settings" does not exist`. Jeśli zamiast tego wywala się na `create extension pgtap`, obraz bazy nie ma pgTAP: dopisz `pgtap` do `[db.extensions]` w `supabase/config.toml` i powtórz.

- [ ] **Step 4: Napisz migrację**

Wpisz do pliku migracji z kroku 1:

```sql
-- Typy ICAO jako domena: ograniczenie domeny jest egzekwowane na każdym
-- elemencie tablicy, więc walidacja nie zależy od warstwy aplikacji.
create domain public.icao_type as text
  check (value ~ '^[A-Z0-9]{2,4}$');

create table public.alert_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  -- numeric(5,2) zaokrągla przy zapisie, więc dokładnej lokalizacji nie da
  -- się zapisać nawet przez pomyłkę (FR-003, ~1 km).
  home_lat       numeric(5,2),
  home_lon       numeric(5,2),
  radius_km      integer not null default 30,
  aircraft_types public.icao_type[] not null default '{}',
  paused         boolean not null default false,
  updated_at     timestamptz not null default now(),

  constraint home_lat_valid check (home_lat between -90 and 90),
  constraint home_lon_valid check (home_lon between -180 and 180),
  constraint radius_sane    check (radius_km between 1 and 100),
  -- Chroni pollera: bez limitu jeden wiersz z tysiącami typów obciąża
  -- dopasowanie wykonywane co minutę dla każdego użytkownika.
  constraint types_bounded  check (coalesce(array_length(aircraft_types, 1), 0) <= 20)
);

-- Grants są drugą warstwą obok polityk: brak insert i delete na poziomie
-- uprawnień znaczy, że nawet błędnie dodana polityka ich nie odblokuje.
revoke all on public.alert_settings from anon;
grant select, update on public.alert_settings to authenticated;

alter table public.alert_settings enable row level security;

create policy "own settings readable"
  on public.alert_settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "own settings updatable"
  on public.alert_settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- security definer, bo trigger pisze do tabeli z RLS, zanim istnieje sesja.
-- search_path = '' zamyka podmianę ścieżki, stąd pełne kwalifikacje nazw.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.alert_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill dla kont założonych przed tą migracją. Bez tego konto testowe
-- z panelu nie miałoby ustawień, a przy braku polityki insert aplikacja
-- nigdy by ich sobie nie dorobiła.
insert into public.alert_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
```

- [ ] **Step 5: Zastosuj migrację lokalnie i uruchom testy**

```bash
npx supabase db reset && npx supabase test db
```

Expected: `alert_settings_rls.sql .. ok` i `All tests successful.` — 12 z 12. Jeśli pada asercja o domenie na tablicy, to jedyne niesprawdzone empirycznie założenie ze speca: usuń domenę, zmień kolumnę na `text[]`, przenieś walidację kodów do aplikacji i skoryguj spec.

- [ ] **Step 6: Dodaj skrypt npm**

W `package.json`, w sekcji `scripts`, po linii `"smoke": "node scripts/smoke.mjs"`:

```json
    "smoke": "node scripts/smoke.mjs",
    "test:db": "supabase test db"
```

- [ ] **Step 7: Uruchom testy przez skrypt**

```bash
npm run test:db
```

Expected: `All tests successful.`

- [ ] **Step 8: Podłącz testy bazy do CI**

W `.github/workflows/ci.yml`, w jobie `smoke`, zaraz po kroku `Start local Supabase` wstaw:

```yaml
- name: Run database tests
  run: supabase test db
```

Job już startuje lokalne Supabase, więc to jedyna linijka, jakiej trzeba. Krok `Run smoke test` zostaje bez zmian i od teraz pełni też rolę testu triggera: jeśli `handle_new_user()` rzuci wyjątek, rejestracja w smoke padnie z „Database error saving new user".

- [ ] **Step 9: Lint i typecheck**

```bash
npm run lint && npx astro sync && npx astro check
```

Expected: brak błędów. Migracja i testy to SQL, więc nie powinny nic ruszyć — to sprawdzenie dotyczy edycji `package.json`.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations supabase/tests package.json .github/workflows/ci.yml
git commit -m "Add alert_settings table with RLS policies

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Granica klucza serwisowego

Reguła powstaje **zanim** istnieje moduł, który miałaby pilnować. To celowe: chodzi o to, żeby wyprzedziła pierwszy import, a nie goniła go.

**Files:**

- Modify: `eslint.config.js`
- Modify: `CLAUDE.md` (sekcja `## Hard rules`, poza blokiem `@przeprogramowani/10x-cli`)
- Modify: `context/deployment/deploy-plan.md`
- Test: `src/lib/__eslint-probe.ts` (plik tymczasowy, kasowany w kroku 4)

**Interfaces:**

- Consumes: nic z Taska 1.
- Produces: kontrakt nazewniczy dla przyszłego kodu — moduł `src/lib/supabase-admin.ts` eksportujący `createAdminClient()`, importowalny wyłącznie z `src/workers/scheduled.ts`.

- [ ] **Step 1: Napisz próbkę, która ma zostać odrzucona**

Utwórz `src/lib/__eslint-probe.ts`:

```typescript
import { createAdminClient } from "@/lib/supabase-admin";

export const probe = createAdminClient;
```

- [ ] **Step 2: Uruchom lint i potwierdź, że reguła jeszcze NIE działa**

```bash
npx eslint src/lib/__eslint-probe.ts
```

Expected: błąd o nierozwiązanym module lub brak zgłoszenia `no-restricted-imports`. Kluczowe: **nie ma** komunikatu o `service_role`. To jest stan „test pada".

- [ ] **Step 3: Dodaj regułę do eslint.config.js**

W `eslint.config.js`, po definicji `scriptsConfig`, dopisz:

```javascript
// Klucz service_role omija RLS. Wartość polityk z alert_settings zależy od tego,
// że kod obsługujący żądania użytkownika nie ma jak po ten klient sięgnąć.
const serviceKeyBoundary = defineConfig({
  files: ["src/**/*.{ts,tsx,astro}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/supabase-admin", "@/lib/supabase-admin"],
            message:
              "supabase-admin używa klucza service_role, który omija RLS. Import wolno wykonać wyłącznie w handlerze scheduled (src/workers/scheduled.ts).",
          },
        ],
      },
    ],
  },
});

const schedulerConfig = defineConfig({
  files: ["src/workers/scheduled.ts", "src/lib/supabase-admin.ts"],
  rules: { "no-restricted-imports": "off" },
});
```

Następnie dopisz oba do listy w `export default defineConfig(...)`, **po** `scriptsConfig` i **przed** `eslintPluginPrettier` — kolejność ma znaczenie, bo `schedulerConfig` zdejmuje regułę nałożoną przez `serviceKeyBoundary`:

```javascript
export default defineConfig(
  includeIgnoreFile(gitignorePath),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  serviceKeyBoundary,
  schedulerConfig,
  eslintPluginPrettier,
);
```

- [ ] **Step 4: Uruchom lint i potwierdź, że reguła łapie**

```bash
npx eslint src/lib/__eslint-probe.ts
```

Expected: `error  ... supabase-admin używa klucza service_role, który omija RLS  no-restricted-imports`

- [ ] **Step 5: Skasuj próbkę i potwierdź czysty lint**

```bash
rm src/lib/__eslint-probe.ts && npm run lint
```

Expected: brak błędów.

- [ ] **Step 6: Dopisz hard rule do CLAUDE.md**

W `CLAUDE.md`, w sekcji `## Hard rules`, po linii zaczynającej się od „Create Supabase clients only with `createClient()`", dopisz:

```markdown
- Klient z kluczem `service_role` (`createAdminClient()` z `src/lib/supabase-admin.ts`) omija RLS i wolno go użyć wyłącznie w handlerze `scheduled`, który nie ma sesji użytkownika. Reguła ESLint `no-restricted-imports` blokuje ten import wszędzie indziej — nie wyłączaj jej lokalnym komentarzem. Kod obsługujący żądania użytkownika zawsze używa klucza `anon` i polega na politykach RLS.
```

- [ ] **Step 7: Popraw deploy-plan.md**

W `context/deployment/deploy-plan.md` znajdź zdanie kończące sekcję „Podpięte sekrety":

> `service_role` obchodzi RLS i nie może trafić do tej aplikacji.

Zastąp je:

```markdown
`service_role` obchodzi RLS. Decyzją z 2026-09-24 trafi do tej aplikacji jako osobny
sekret `SUPABASE_SERVICE_KEY`, ale wyłącznie dla handlera `scheduled`, który nie ma
sesji użytkownika i musi czytać ustawienia wszystkich kont. Granicy pilnuje reguła
ESLint `no-restricted-imports` (patrz `CLAUDE.md`). Sekret zostanie podpięty dopiero
razem z pollerem — dziś nie istnieje ani w `astro.config.mjs`, ani w Workers Secrets.
Szczegóły: `docs/superpowers/specs/2026-09-24-alert-settings-rls-design.md`.
```

Uwaga: pre-commit uruchamia Prettier na plikach `.md`, który wyrównuje tabele kolumnowo. Edytuj ten plik przez dokładne dopasowanie tekstu, nie przez regex na szerokości kolumn.

- [ ] **Step 8: Lint i commit**

```bash
npm run lint
```

Expected: brak błędów.

```bash
git add eslint.config.js CLAUDE.md context/deployment/deploy-plan.md
git commit -m "Fence the service_role client behind a lint rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Wypchnięcie na produkcję

Bramki ręczne: `supabase link` pyta o hasło do bazy, którego agent nie ma i mieć nie powinien. Zgodnie z granicą dostępu z `deploy-plan.md` hasła i tworzenie zasobów należą do człowieka.

**Files:** brak zmian w repo — ten task tylko stosuje istniejącą migrację.

- [ ] **Step 1: (człowiek) Połącz projekt ze zdalnym**

```bash
npx supabase link --project-ref nwphfexokrngshgmhucf
```

CLI poprosi o hasło bazy z panelu Supabase (_Project Settings → Database_). Referencja pochodzi z `context/deployment/deploy-plan.md`.

- [ ] **Step 2: Zobacz, co pójdzie na produkcję, zanim pójdzie**

```bash
npx supabase db push --dry-run
```

Expected: lista zawierająca dokładnie jeden plik migracji `<timestamp>_alert_settings.sql`. Jeśli jest ich więcej, zatrzymaj się — znaczy, że lokalna historia rozjechała się ze zdalną.

- [ ] **Step 3: Zastosuj migrację**

```bash
npx supabase db push
```

Expected: `Finished supabase db push.`

- [ ] **Step 4: Sprawdź, że polityki stoją na produkcji**

```bash
npx supabase inspect db table-stats --linked 2>/dev/null | grep -i alert_settings || echo "sprawdź w panelu"
```

Pewniejsze jest zapytanie w panelu Supabase (_SQL Editor_), bo pokazuje polityki wprost:

```sql
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public' and tablename = 'alert_settings';
```

Expected: dwa wiersze — `SELECT` i `UPDATE`, oba dla `{authenticated}`. Żadnego `INSERT` ani `DELETE`.

- [ ] **Step 5: Potwierdź backfill dla istniejącego konta**

W panelu Supabase (_SQL Editor_):

```sql
select count(*) as users, (select count(*) from public.alert_settings) as settings
  from auth.users;
```

Expected: obie liczby równe. Jeśli `settings` jest mniejsze, backfill nie zadziałał i konto testowe nie ma ustawień.

- [ ] **Step 6: Potwierdź, że produkcja nadal żyje**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://nad-glowa.mateusz-kosciolko-321.workers.dev/ && curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://nad-glowa.mateusz-kosciolko-321.workers.dev/dashboard
```

Expected: `200`, potem `302 https://nad-glowa.mateusz-kosciolko-321.workers.dev/auth/signin`. Migracja nie dotyka Workera, więc zmiana tych wyników znaczyłaby, że coś innego poszło nie tak.

- [ ] **Step 7: Odnotuj stan w deploy-plan.md**

W `context/deployment/deploy-plan.md`, w tabeli „Czego NIE wdrożono", zamień wiersz `| Migracje Supabase / RLS | …` na:

```markdown
| ~~Migracje Supabase / RLS~~ | **Częściowo zamknięte 2026-09-24**: `alert_settings` z politykami RLS na produkcji. Pozostają tabele powiadomień (FR-009/FR-010) i logu obserwacji (FR-011) |
```

- [ ] **Step 8: Commit**

```bash
git add context/deployment/deploy-plan.md
git commit -m "Record alert_settings migration on production

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review — pokrycie speca

| Wymaganie ze speca                               | Task                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Domena `icao_type` + walidacja elementów tablicy | 1, kroki 4–5 (z opisaną ścieżką awaryjną)                                   |
| `numeric(5,2)` wymusza precyzję FR-003           | 1, test „typ kolumny zaokrąglił szerokość"                                  |
| Nullowalne współrzędne                           | 1, krok 4 (kolumny bez `not null`)                                          |
| `types_bounded` chroni pollera                   | 1, krok 4                                                                   |
| Dwie polityki, brak `insert` i `delete`          | 1, testy „dokładnie dwie polityki", „delete nie usunął", „insert odrzucony" |
| `to authenticated`, odcięcie `anon`              | 1, krok 4 (`revoke ... from anon`)                                          |
| `(select auth.uid())`                            | 1, krok 4                                                                   |
| Trigger `security definer` z `search_path = ''`  | 1, krok 4; test „trigger utworzył wiersz"                                   |
| Znany tryb awarii triggera przy rejestracji      | 1, krok 8 (smoke w CI jako detektor)                                        |
| Wariant A granicy klucza serwisowego             | 2, kroki 1–6                                                                |
| `SUPABASE_SERVICE_KEY` poza zakresem             | Global Constraints; 2, krok 7                                               |
| Kroki weryfikacji ze speca                       | 1 krok 5, 3 kroki 4–5                                                       |
| Backfill istniejących kont                       | 1, krok 4 — **dopisane poza specem**, patrz niżej                           |

**Odstępstwo od speca:** spec nie przewidywał backfillu, bo pisaliśmy go, zanim sprawdziłem stan produkcji. Konto założone ręcznie przy weryfikacji wdrożenia nie dostałoby wiersza ustawień, a brak polityki `insert` znaczy, że aplikacja nie mogłaby go dorobić. Po wykonaniu planu dopisać ten akapit do speca.
