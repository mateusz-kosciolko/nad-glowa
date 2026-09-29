begin;
create extension if not exists pgtap;
select plan(11);

-- ── struktura ────────────────────────────────────────────────────────
select has_table('public'::name, 'cron_runs'::name);

select is(
  (select relrowsecurity from pg_class where oid = 'public.cron_runs'::regclass),
  true,
  'RLS jest włączone'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'cron_runs'),
  1,
  'dokładnie jedna polityka — select, bez insert i delete'
);

-- ── ograniczenia (jako właściciel, jak service_role) ─────────────────
select throws_ok(
  $$insert into public.cron_runs (started_at, duration_ms, status, error)
     values (now(), 0, 'ok', 'x')$$,
  '23514',
  null,
  'udany bieg nie niesie komunikatu błędu'
);

select throws_ok(
  $$insert into public.cron_runs (started_at, duration_ms, status)
     values (now(), 0, 'skipped')$$,
  '23514',
  null,
  'status spoza ok/error odrzucony'
);

-- Wiersz testowy wstawia właściciel tabeli, tak jak service_role omija RLS.
insert into public.cron_runs (started_at, duration_ms, status)
values ('2000-01-01T00:00:00Z', 5, 'ok');

-- ── RLS oczami zalogowanego użytkownika ──────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Filtr po started_at, bo lokalna baza może mieć już biegi z cron:local.
select is(
  (select count(*)::int from public.cron_runs
    where started_at = '2000-01-01T00:00:00Z'),
  1,
  'zalogowany użytkownik czyta biegi'
);

-- error może zawierać dane innego użytkownika, więc zalogowany jej nie czyta.
select throws_ok(
  $$select error from public.cron_runs$$,
  '42501',
  null,
  'zalogowany użytkownik nie czyta kolumny error'
);

select throws_ok(
  $$insert into public.cron_runs (started_at, duration_ms, status)
     values (now(), 1, 'ok')$$,
  '42501',
  null,
  'insert odrzucony — zapisuje wyłącznie handler scheduled'
);

select throws_ok(
  $$update public.cron_runs set status = 'error'$$,
  '42501',
  null,
  'update odrzucony — ślad biegów jest tylko do odczytu'
);

select throws_ok(
  $$delete from public.cron_runs$$,
  '42501',
  null,
  'delete odrzucony — retencję wykonuje wyłącznie handler scheduled'
);

-- ── anon ─────────────────────────────────────────────────────────────
reset role;
set local role anon;

select throws_ok(
  $$select count(*) from public.cron_runs$$,
  '42501',
  null,
  'anon nie czyta biegów'
);

select * from finish();
rollback;
