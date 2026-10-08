<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Wstrzymanie i wznowienie alertów (S-05)

- **Plan**: context/changes/pause-resume-alerts/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated checks re-run on 2026-10-08:

- `npm run smoke` passes (including the 9 pause steps).
- `npm run test:db` passes.
- Lint, 31 unit tests, `astro check` (0 errors) and build all pass.

All six planned changes match the plan, and nothing from "What We're NOT Doing" was done. The three adaptations are corrections, not drift: pgTAP uses `paused = false` on the other user's row, which is the only value that really tests RLS; a missing settings row is treated like a read error; the confirmation texts are "Alerts paused." and "Alerts resumed.". Authorization, CSRF and XSS were checked; RLS, `checkOrigin` and Astro escaping cover them.

## Findings

### F1 — Attacker-chosen error text via `?alerts_error=`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:57,120
- **Detail**: A crafted link such as `/dashboard?alerts_error=Your account is locked…` shows any text in red on the dashboard. It is escaped, so it is text only, and the page requires login. `?error=` and `?telegram_error=` on `/settings` follow the same pattern.
- **Fix**: Accept as a project-wide pattern; if it is ever hardened, switch all three parameters to error codes mapped to fixed messages.
- **Decision**: FIXED — /settings ?error=, ?telegram_error= and /dashboard ?alerts_error= carry codes mapped by messageForCode() (src/lib/form-errors.ts); unknown → generic message; DB/Telegram details logged server-side; /auth/signin unchanged. Smoke step proves free text is not rendered.

### F2 — Confirmation is driven only by the URL

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:119
- **Detail**: "Alerts paused." comes from `?alerts=paused`. It stays after a reload or bookmark, and it can appear next to "Alert status unavailable." when the state read fails. Cosmetic; `/settings?saved=1` behaves the same.
- **Fix**: Show the confirmation only when it agrees with the state just read (`alerts=paused` and `alertsPaused === true`, and the same for resume).
- **Decision**: FIXED — confirmation shown only when ?alerts= matches the state just read.

### F3 — Two sequential dashboard queries

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:22-27,47
- **Detail**: The `alert_settings` read runs after the `cron_runs` read instead of in parallel, so each dashboard load makes one extra round-trip to Supabase.
- **Fix**: Run both reads with `Promise.all`.
- **Decision**: FIXED — cron_runs and alert_settings reads run in Promise.all, failure handling per card.

### F4 — Inconsistent `whitespace-nowrap` on the card buttons

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:114
- **Detail**: Only the "Resume alerts" button has `whitespace-nowrap`; "Pause alerts" does not, so on a narrow screen it can wrap onto two lines.
- **Fix**: Add `whitespace-nowrap` to the "Pause alerts" button.
- **Decision**: FIXED — whitespace-nowrap on "Pause alerts".
