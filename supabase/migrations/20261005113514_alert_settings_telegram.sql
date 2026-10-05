-- Kanał powiadomień Telegram per użytkownik. Kolumna dziedziczy table-level
-- grant select/update dla authenticated oraz polityki „own settings”, więc
-- granty i polityki zostają bez zmian. bigint, bo ID grup są ujemne i
-- przekraczają zakres integer.
alter table public.alert_settings add column telegram_chat_id bigint;
