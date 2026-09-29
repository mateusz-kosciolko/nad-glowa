-- Kolumna error może po wpięciu pollera (S-03) nieść szczegóły ustawień lub
-- przybliżonej lokalizacji konkretnego użytkownika, a polityka select jest
-- wspólna dla wszystkich zalogowanych. Dlatego zalogowani dostają tylko
-- kolumny potrzebne do oceny, czy zadanie żyje; error czyta wyłącznie
-- service_role (log handlera i Studio).
revoke select on public.cron_runs from authenticated;
grant select (id, started_at, duration_ms, status) on public.cron_runs to authenticated;
