begin;
create extension if not exists pgtap;
select plan(7);

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
  0,
  'zero polityk — dziennik czyta i zapisuje wyłącznie service_role'
);

-- ── ograniczenia (jako właściciel, jak service_role) ─────────────────
-- Użytkownik testowy, żeby klucz obcy nie maskował sprawdzanego ograniczenia.
insert into auth.users (id) values ('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into public.alert_notifications
      (user_id, aircraft_hex, aircraft_type, closest_at, closest_distance_km, already_close)
     values ('22222222-2222-2222-2222-222222222222', 'abc123', 'B738', now(), -0.5, false)$$,
  '23514',
  null,
  'ujemna odległość odrzucona'
);

-- ── RLS oczami zalogowanego użytkownika ──────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select throws_ok(
  $$select count(*) from public.alert_notifications$$,
  '42501',
  null,
  'zalogowany użytkownik nie czyta dziennika'
);

select throws_ok(
  $$insert into public.alert_notifications
      (user_id, aircraft_hex, aircraft_type, closest_at, closest_distance_km, already_close)
     values ('22222222-2222-2222-2222-222222222222', 'abc123', 'B738', now(), 1.0, false)$$,
  '42501',
  null,
  'insert odrzucony — zapisuje wyłącznie handler scheduled'
);

-- ── anon ─────────────────────────────────────────────────────────────
reset role;
set local role anon;

select throws_ok(
  $$select count(*) from public.alert_notifications$$,
  '42501',
  null,
  'anon nie czyta dziennika'
);

select * from finish();
rollback;
