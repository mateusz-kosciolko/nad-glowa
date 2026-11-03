-- Historia alertów (FR-011): właściciel czyta swoje wpisy i usuwa stare.
-- Ta tabela jest też pamięcią deduplikacji pollera, więc usunięcie wpisu z okna
-- wznowiłoby alert o tej samej maszynie. Reguła siedzi w polityce, a nie w endpoincie.
-- 60 minut to DEDUP_WINDOW_MS z src/lib/alerts.ts; granica jak w isRecentlyAlerted.
-- Insert i update zostają wyłącznie dla handlera scheduled (service_role).
grant select, delete on public.alert_notifications to authenticated;

create policy "own alerts readable"
  on public.alert_notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "own old alerts deletable"
  on public.alert_notifications
  for delete
  to authenticated
  using ((select auth.uid()) = user_id and sent_at <= now() - interval '60 minutes');
