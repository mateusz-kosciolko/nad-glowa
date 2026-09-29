---
change_id: minute-cron-heartbeat
title: Minute cron heartbeat
status: impl_reviewed
created: 2026-09-28
updated: 2026-09-29
archived_at: null
---

## Notes

- Uzupełnienie planu (przegląd implementacji, F6): `.claude/launch.json` dostał konfigurację `astro-preview`
  (`npm run preview -- --port 4321`) do bramki 1.7 i powtarzania lokalnie joba smoke z CI. Używa tego samego
  portu co `astro-dev`, więc przed jej startem trzeba zatrzymać dev server; `npm run preview` wymaga wcześniejszego
  `npm run build`.
