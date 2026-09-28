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
-- Domyślne uprawnienia Supabase na schemacie public dają authenticated
-- wszystkie prawa do nowych tabel, a grant ich nie odbiera — stąd revoke.
revoke all on public.alert_settings from anon;
revoke all on public.alert_settings from authenticated;
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
