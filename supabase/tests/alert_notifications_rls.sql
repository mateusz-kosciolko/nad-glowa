begin;
create extension if not exists pgtap;
select plan(11);

-- ── struktura ────────────────────────────────────────────────────────
select has_table('public'::name, 'alert_notifications'::name);

select is(
  (select relrowsecurity from pg_class where oid = 'public.alert_notifications'::regclass),
  true,
  'RLS jest włączone'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'alert_notifications'),
  2,
  'dwie polityki — odczyt własnych i usuwanie własnych starych wpisów'
);

-- ── ograniczenia (jako właściciel, jak service_role) ─────────────────
-- Użytkownicy testowi, żeby klucz obcy nie maskował sprawdzanego ograniczenia.
insert into auth.users (id) values
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$insert into public.alert_notifications
      (user_id, aircraft_hex, aircraft_type, closest_at, closest_distance_km, already_close)
     values ('22222222-2222-2222-2222-222222222222', 'abc123', 'B738', now(), -0.5, false)$$,
  '23514',
  null,
  'ujemna odległość odrzucona'
);

insert into public.alert_notifications
  (user_id, aircraft_hex, aircraft_type, sent_at, closest_at, closest_distance_km, already_close)
values
  ('22222222-2222-2222-2222-222222222222', 'fresh2', 'B738', now() - interval '59 minutes', now(), 1.0, false),
  ('22222222-2222-2222-2222-222222222222', 'old222', 'B738', now() - interval '60 minutes', now(), 1.0, false),
  ('33333333-3333-3333-3333-333333333333', 'old333', 'B738', now() - interval '2 hours', now(), 1.0, false);

-- ── RLS oczami zalogowanego użytkownika ──────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select array_agg(aircraft_hex order by aircraft_hex) from public.alert_notifications),
  array['fresh2', 'old222'],
  'zalogowany czyta wyłącznie własne wpisy'
);

select throws_ok(
  $$insert into public.alert_notifications
      (user_id, aircraft_hex, aircraft_type, closest_at, closest_distance_km, already_close)
     values ('22222222-2222-2222-2222-222222222222', 'abc123', 'B738', now(), 1.0, false)$$,
  '42501',
  null,
  'insert odrzucony — zapisuje wyłącznie handler scheduled'
);

select throws_ok(
  $$update public.alert_notifications set already_close = true$$,
  '42501',
  null,
  'update odrzucony — dziennik jest zapisem faktów'
);

-- Delete bez warunku: polityka sama musi zostawić świeże i cudze wpisy.
select lives_ok(
  $$delete from public.alert_notifications$$,
  'delete bez warunku nie zgłasza błędu'
);

select is(
  (select array_agg(aircraft_hex) from public.alert_notifications),
  array['fresh2'],
  'usunięty własny wpis sprzed okna; wpis z okna deduplikacji został'
);

-- ── wpis innego użytkownika (jako właściciel) ────────────────────────
reset role;

select is(
  (select count(*)::int from public.alert_notifications where aircraft_hex = 'old333'),
  1,
  'cudzy stary wpis nietknięty'
);

-- ── anon ─────────────────────────────────────────────────────────────
set local role anon;

select throws_ok(
  $$select count(*) from public.alert_notifications$$,
  '42501',
  null,
  'anon nie czyta dziennika'
);

select * from finish();
rollback;
