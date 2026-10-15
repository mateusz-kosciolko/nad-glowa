---
change_id: middleware-auth-error-observability
title: Middleware logs getUser() errors and answers 503 on Auth outages
status: implemented
created: 2026-10-15
updated: 2026-10-15
archived_at: null
---

## Notes

— Fix observability finding A1 (+A5): middleware must branch on getUser() error: log non-session-missing errors, 503 on retryable, warn when sb-* cookie request is redirected

Source: context/audits/observability/2026-10-15_alert-poll-alert-settings-auth.md (A1, A5; recommended fix #1).
