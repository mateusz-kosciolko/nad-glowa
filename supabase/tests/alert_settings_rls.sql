begin;
create extension if not exists pgtap;
select plan(12);

-- ── struktura ────────────────────────────────────────────────────────
select has_table('public'::name, 'alert_settings'::name);

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

-- Liczymy tylko wiersze testowe, bo lokalna baza może mieć konta założone
-- przez smoke.
select is(
  (select count(*)::int from public.alert_settings
    where user_id in ('11111111-1111-1111-1111-111111111111',
                      '22222222-2222-2222-2222-222222222222')),
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

-- Brak uprawnienia delete (revoke w migracji) odrzuca operację, zanim
-- dojdzie do polityk, więc wiersz zostaje nietknięty.
select throws_ok(
  $$delete from public.alert_settings
     where user_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'delete odrzucony — brak uprawnienia i polityki delete (FR-006)'
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
