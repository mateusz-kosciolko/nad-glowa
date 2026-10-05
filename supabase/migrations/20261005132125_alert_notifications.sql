-- Dziennik wysłanych alertów: pamięć deduplikacji pollera (ta sama maszyna
-- najwyżej raz na okno) i dowód kryterium „≥ 2 min przed” (sent_at kontra
-- closest_at). Celowo bez współrzędnych domu i samolotu — wiersz mówi, co
-- i kiedy wysłano, a nie gdzie mieszka użytkownik.
create table public.alert_notifications (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  aircraft_hex        text not null,
  registration        text,
  aircraft_type       text not null,
  sent_at             timestamptz not null default now(),
  closest_at          timestamptz not null,
  closest_distance_km numeric(6,1) not null check (closest_distance_km >= 0),
  already_close       boolean not null
);

-- Deduplikacja czyta wpisy jednego użytkownika z ostatniej godziny.
create index alert_notifications_user_sent_at_idx
  on public.alert_notifications (user_id, sent_at desc);

-- Czyta i zapisuje wyłącznie handler scheduled kluczem service_role, który
-- omija uprawnienia i RLS. Domyślne uprawnienia Supabase na schemacie public
-- dają anon i authenticated wszystkie prawa do nowych tabel — stąd revoke.
revoke all on public.alert_notifications from anon;
revoke all on public.alert_notifications from authenticated;

-- RLS bez żadnej polityki: nawet przypadkowy grant nie odsłoni wierszy.
-- Polityka select dla własnych wierszy przyjdzie z FR-011 (historia alertów).
alter table public.alert_notifications enable row level security;
