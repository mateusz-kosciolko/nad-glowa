-- Ślad każdego biegu crona: dowód, że zegar tyka, i miejsce na błąd,
-- zanim poller (S-03) zacznie wykonywać tu prawdziwą pracę.
create table public.cron_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  status      text not null check (status in ('ok', 'error')),
  error       text,

  -- Udany bieg nie niesie komunikatu błędu, więc odczyt nie musi zgadywać,
  -- który z dwóch sygnałów jest prawdziwy.
  constraint error_only_on_failure check (status = 'error' or error is null)
);

-- Panel pokazuje ostatnie biegi, a retencja usuwa najstarsze — oba zapytania
-- idą po started_at.
create index cron_runs_started_at_idx on public.cron_runs (started_at desc);

-- Zapisuje wyłącznie handler scheduled kluczem service_role, który omija
-- uprawnienia i RLS. Domyślne uprawnienia Supabase na schemacie public dają
-- anon i authenticated wszystkie prawa do nowych tabel — stąd revoke, a potem
-- tylko select dla zalogowanych.
revoke all on public.cron_runs from anon;
revoke all on public.cron_runs from authenticated;
grant select on public.cron_runs to authenticated;

alter table public.cron_runs enable row level security;

-- Tabela nie zawiera danych użytkowników, więc każdy zalogowany może ją czytać.
create policy "cron runs readable"
  on public.cron_runs for select
  to authenticated
  using (true);
