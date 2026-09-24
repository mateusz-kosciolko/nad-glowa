---
project: nad-glowa
designed_at: 2026-09-24
scope: alert_settings table + RLS policies
status: approved
supersedes: none
---

# alert_settings — schemat i RLS

Pierwszy schemat bazy w tym projekcie. Zakres celowo ograniczony do jednej tabeli
pokrywającej FR-002…FR-006 z `context/foundation/prd.md`. Tabela powiadomień
(FR-009, FR-010) i log obserwacji (FR-011) powstaną osobno.

## Dlaczego RLS jest tu warunkiem koniecznym

`SUPABASE_KEY` (klucz `anon`) jest w tej aplikacji czytany wyłącznie przez
`astro:env/server`, więc nie trafia do przeglądarki — to nie jest projekt, w którym
klucz jest jawnie publiczny. RLS jest jednak wymagany z trzech innych powodów:

1. **Błędne zapytanie zawodzi bezpiecznie.** `select()` bez `.eq("user_id", …)`
   zwraca wszystkie wiersze. Z RLS zwraca tylko własne. Filtr w kodzie da się
   zgubić przy refaktorze; polityka w bazie nie.
2. **Klucz jest jeden import od upublicznienia** — wystarczy import `@/lib/supabase`
   z wyspy React. Hard rule w `CLAUDE.md` tego zabrania, ale reguła to nie mechanizm.
3. **PRD już to specyfikuje** (Access Control): _„each user sees and manages only
   their own home location, watch rules and sighting log; no user can see another
   user's data"_.

## Decyzje projektowe

| Decyzja              | Wybór                                                            | Odrzucone alternatywy                               |
| -------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Precyzja lokalizacji | `numeric(5,2)` — typ wymusza zaokrąglenie                        | `double precision` + zaokrąglanie w kodzie; PostGIS |
| Typy statków         | `icao_type[]` w tym samym wierszu                                | tabela złączeniowa; `jsonb`                         |
| Powstanie wiersza    | trigger `security definer` na `auth.users`                       | upsert przy pierwszym zapisie                       |
| Dostęp pollera       | osobny `SUPABASE_SERVICE_KEY`, wariant A (moduł + reguła ESLint) | funkcja RPC `security definer`; tabela bez RLS      |

## Schemat

```sql
create domain public.icao_type as text
  check (value ~ '^[A-Z0-9]{2,4}$');

create table public.alert_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  home_lat       numeric(5,2),
  home_lon       numeric(5,2),
  radius_km      integer not null default 30,
  aircraft_types public.icao_type[] not null default '{}',
  paused         boolean not null default false,
  updated_at     timestamptz not null default now(),

  constraint home_lat_valid check (home_lat between -90 and 90),
  constraint home_lon_valid check (home_lon between -180 and 180),
  constraint radius_sane    check (radius_km between 1 and 100),
  constraint types_bounded  check (coalesce(array_length(aircraft_types, 1), 0) <= 20)
);
```

**`numeric(5,2)` zaokrągla, nie odrzuca.** Zapis `52.23456` daje `52.23`. To realizacja
FR-003 („stored only approximately, ~1 km precision") jako własności typu, a nie linijki
TypeScriptu: aplikacja nie jest w stanie zapisać dokładnej lokalizacji nawet przez pomyłkę.
Na 52°N komórka ma ~1,1 × 0,7 km. Pięć cyfr znaczących mieści `-180.00`…`180.00`.

**Współrzędne są nullowalne**, bo wiersz powstaje przy zakładaniu konta, gdy lokalizacji
jeszcze nie znamy. Poller filtruje `home_lat is not null` obok `paused = false`.

**`types_bounded` chroni pollera**, nie dane: bez limitu jeden wiersz z tysiącami typów
obciąża dopasowanie wykonywane co minutę dla każdego użytkownika. `array_length` jest
immutable, więc wolno go użyć w `check` — `unnest` nie, bo `check` nie przyjmuje podzapytań.

**Domena `icao_type` wymaga weryfikacji lokalnej.** Zakładamy, że Postgres egzekwuje
ograniczenie domeny na elementach tablicy tej domeny. To jedyne założenie w tym projekcie
niesprawdzone empirycznie — potwierdzić przez `supabase db reset` przed `db push`.
Jeśli nie działa, walidacja pojedynczych kodów spada do warstwy aplikacji, a reszta
schematu zostaje bez zmian.

## Polityki

```sql
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
```

Dwie polityki zamiast czterech — celowo.

**Brak polityki `insert`**: wiersz tworzy trigger, nie użytkownik.

**Brak polityki `delete`**: PRD przy FR-006 zamienił kasowanie reguły na pauzę
(_„rule deletion replaced by pause/resume"_). Przy włączonym RLS brak polityki znaczy
„operacja niemożliwa", więc nieusuwalność jest wymuszona przez bazę, a nie przez brak
przycisku. Usunięcie konta nadal sprząta wiersz przez `on delete cascade`, które działa
poza RLS.

`to authenticated` odcina rolę `anon`, która ma domyślne grants Supabase na `public`.
`(select auth.uid())` zamiast gołego wywołania — Postgres liczy je raz na zapytanie
(InitPlan), a nie raz na wiersz.

## Trigger

```sql
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
```

`security definer` jest konieczne: trigger pisze do tabeli z RLS, zanim istnieje sesja
użytkownika. `set search_path = ''` zamyka podmianę `search_path` w funkcji definer,
dlatego wszystkie nazwy są w pełni kwalifikowane. Trigger obejmuje także konta zakładane
ręcznie w panelu Supabase, co według PRD jest jedyną drogą rejestracji.

**Znany tryb awarii**: wyjątek w tej funkcji objawia się przy zakładaniu konta jako
nieczytelne „Database error saving new user". Przy diagnozie problemów z rejestracją
sprawdzać ten trigger w pierwszej kolejności.

## Dostęp pollera (przyszły handler `scheduled`)

Poller nie ma sesji użytkownika, więc pod kluczem `anon` `auth.uid()` jest `null`
i RLS zwróci zero wierszy. Musi czytać ustawienia wszystkich użytkowników, więc
użyje `SUPABASE_SERVICE_KEY`, który omija RLS.

Wariant A wymuszenia granicy, obowiązujący od teraz:

- `createAdminClient()` mieszka w osobnym pliku `src/lib/supabase-admin.ts`.
- Reguła ESLint `no-restricted-imports` zabrania importu tego pliku poza handlerem
  `scheduled`. Lint chodzi w pre-commit i w CI, więc naruszenie wywala się przed merge'em.
- `SUPABASE_SERVICE_KEY` **nie** wchodzi do `astro.config.mjs` ani do Workers Secrets,
  dopóki handler nie istnieje. Nieużywany sekret w schemacie to zaproszenie do użycia
  go nie tam, gdzie trzeba.

Wariant C (poller jako osobny Worker, bez tego klucza w środowisku aplikacji) jest
mocniejszy i dodatkowo omija konieczność pisania własnego entrypointu wokół
`@astrojs/cloudflare`. Decyzja między A i C zapada przy pierwszym handlerze `scheduled`,
z kosztem wrappera na stole.

## Poza zakresem

| Element                               | Dlaczego nie teraz                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Indeksy                               | Przy jednym użytkowniku skan sekwencyjny jest szybszy; indeks to później jedna migracja                                                      |
| Tabela powiadomień + deduplikacja     | FR-009/FR-010 — razem z pollerem                                                                                                             |
| Log obserwacji                        | FR-011 jest nice-to-have                                                                                                                     |
| Lista referencyjna typów ICAO         | Dane statyczne, nie dane użytkownika — nie wymagają RLS; forma (stała w repo czy tabela) to osobna decyzja z uwagi na rozmiar bundla Workera |
| `SUPABASE_SERVICE_KEY` w konfiguracji | Dodawany razem z handlerem `scheduled`                                                                                                       |

## Weryfikacja

1. `npx supabase start && npx supabase db reset` — migracja przechodzi, domena egzekwuje wzorzec.
2. Utworzyć użytkownika lokalnie → wiersz w `alert_settings` istnieje z domyślnymi wartościami.
3. Jako użytkownik A: `select` zwraca własny wiersz; `select` po `user_id` użytkownika B zwraca zero wierszy.
4. `delete` na własnym wierszu zwraca zero usuniętych (brak polityki).
5. `insert` z poziomu aplikacji odrzucony (brak polityki).
6. Dopiero wtedy `npx supabase db push`.
