begin;
create extension if not exists pgtap;
select plan(11);

-- ── struktura ────────────────────────────────────────────────────────
select has_table('public'::name, 'aircraft_types'::name);

select is(
  (select relrowsecurity from pg_class where oid = 'public.aircraft_types'::regclass),
  true,
  'RLS jest włączone'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'aircraft_types'),
  1,
  'dokładnie jedna polityka — select, bez insert, update i delete'
);

-- ── RLS oczami zalogowanego użytkownika ──────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select cmp_ok(
  (select count(*)::int from public.aircraft_types),
  '>',
  2000,
  'zalogowany użytkownik czyta pełny słownik'
);

select is(
  (select count(*)::int from public.aircraft_types where featured),
  14,
  'dokładnie 14 wyróżnionych typów'
);

-- Pusta nazwa odpada już na check, ale wybierak pokazuje nazwę wyróżnionych,
-- więc pilnujemy tego jawnie.
select is(
  (select count(*)::int from public.aircraft_types where featured and name <> ''),
  14,
  'każdy wyróżniony typ ma nazwę'
);

select throws_ok(
  $$insert into public.aircraft_types (code, name) values ('ZZZZ', 'TEST')$$,
  '42501',
  null,
  'insert odrzucony — słownik zmienia wyłącznie migracja'
);

select throws_ok(
  $$update public.aircraft_types set featured = true$$,
  '42501',
  null,
  'update odrzucony — słownik jest tylko do odczytu'
);

select throws_ok(
  $$delete from public.aircraft_types$$,
  '42501',
  null,
  'delete odrzucony — słownik jest tylko do odczytu'
);

-- ── anon ─────────────────────────────────────────────────────────────
reset role;
set local role anon;

select throws_ok(
  $$select count(*) from public.aircraft_types$$,
  '42501',
  null,
  'anon nie czyta słownika'
);

reset role;

select is(
  (select array_agg(code::text order by code) from public.aircraft_types where featured),
  array['A124','A3ST','A400','AN12','B52','B748','BLCF','C130','C17','C30J','E3TF','H47','IL76','K35R'],
  'wyróżnione to dokładnie lista z planu'
);

select * from finish();
rollback;
