<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Pierwszy alert przed przelotem (S-03)

- **Plan**: context/changes/first-advance-alert/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated checks run on 2026-10-08: `npm test` (26 passed), `npm run lint`, `npx astro sync && npx astro check` (0 errors), `npm run build`, `npm run test:db` (33 passed), `npm run smoke` (all passed). Every planned file matches the plan's contract. The only unplanned additions are defensive: skipping a user when reading recent alerts fails, two extra error redirects in `telegram-test.ts`, and a third pgTAP assertion.

## Findings

### F1 — Permanent Telegram errors retried every minute

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/workers/alert-poller.ts:144-147
- **Detail**: Every failed send is handled the same way: `fail(...)` and `continue`. No row is written, so the next run tries again. That is right for temporary errors. But with 403 "bot was blocked by the user" or 400 "chat not found", every matching aircraft is sent again each minute for up to 15 min (`LEAD_MAX_S`). Each new aircraft repeats this. Every run then ends with `status: error`, and the dashboard permanently shows "(last run failed)". A 429 response ignores `retry_after`, and the run keeps sending to the remaining users.
- **Fix A ⭐ Recommended**: Branch on `httpStatus` in the poller. For 403, and for 400 with "chat not found", skip the user's remaining candidates in this run and log one error per user. For 429, stop sending for the rest of the run.
  - Strength: A small change in one file. Uses the `httpStatus` that `telegram.ts` already returns, with no migration.
  - Tradeoff: A blocked user still produces one error per run until they change their settings.
  - Confidence: HIGH — the error shape is already in place (`src/lib/telegram.ts`).
  - Blind spot: Have not checked whether Telegram returns 400 for other permanent cases.
- **Fix B**: Also mark the channel as invalid, either with a `telegram_disabled_at` column or by clearing `telegram_chat_id`. Then skip that user until they save their settings again.
  - Strength: Ends the stream of errors for good.
  - Tradeoff: Needs a migration, a pgTAP test and a message on `/settings`, so it is more scope than this change.
  - Confidence: MED — needs a decision on how to show it in the UI.
  - Blind spot: How users find out their channel was turned off.
- **Decision**: FIXED via Fix A — 429 stops sending for the rest of the run (skipped users counted in errors); 400/403 skip the user's remaining candidates (src/workers/alert-poller.ts).

### F2 — No run time budget; overlapping runs can send duplicate alerts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/workers/alert-poller.ts:81-92, 116-162
- **Detail**: A run takes at least 1.1 s per user, plus up to 10 s per ADS-B request and per Telegram send. Nothing caps the total time. Around 50 users, a run goes past 60 s, and Cloudflare starts the next one anyway. Duplicate detection is read-then-write with no lock: run B reads before run A inserts, so both send. Two overlapping runs also break the 1 request/s limit for adsb.fi and risk a 4xx block. This does not matter at today's scale (one local user, about 5 s per run). It becomes real once the cron runs in production (`## Parked` in the roadmap).
- **Fix A ⭐ Recommended**: Defer it. Add an entry to `## Open Roadmap Questions` or `## Parked` in the roadmap, tied to moving the cron to production: run time budget, run lock, and grouping requests for users close to each other.
  - Strength: Matches the change's scope (local only, as in F-02) and keeps the problem in the source of truth.
  - Tradeoff: The production deploy gets one more prerequisite.
  - Confidence: HIGH — measured run time today is 4.5–6.3 s.
  - Blind spot: How fast the user count will grow.
- **Fix B**: Add a time budget now: no new users after about 45 s from the start of the run, with the skipped count in `errors`.
  - Strength: Cheap, and rules out overlaps from long runs.
  - Tradeoff: Does not fix the race on its own (that needs a lock), and some users miss a run.
  - Confidence: MED — 45 s is a guess.
  - Blind spot: Overlaps for reasons other than run length, such as Cloudflare retries.
- **Decision**: FIXED via Fix A — prerequisite added to the Parked entry "Pobieranie ADS-B i zadanie cykliczne na serwerze" in context/foundation/roadmap.md.

### F3 — ADS-B network errors can carry home coordinates into cron_runs.error

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/adsb.ts:163 (via src/workers/alert-poller.ts:99)
- **Detail**: The adsb.fi URL has the home lat/lon in its path (`adsb.ts:17`). `describeFetchError` passes `error.message` through unchanged, so a runtime that quotes the URL in a network error puts the coordinates into the log and `cron_runs.error`. That breaks the promise in the poller's header (lines 3-4). `telegram.ts` redacts the token for exactly this reason. The impact is small: only `service_role` can read `cron_runs.error`, and the coordinates are rounded to 2 decimal places.
- **Fix**: In `describeFetchError`, replace `/lat/<n>/lon/<n>` in the message with `/lat/…/lon/…`, the same way `telegram.ts` redacts the token.
- **Decision**: FIXED — describeFetchError replaces /lat/<n>/lon/<n> with /lat/…/lon/… (src/lib/adsb.ts).

### F4 — README tells you to set a production secret, against the plan

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: README.md:131
- **Detail**: Step 2 says to run `npx wrangler secret put TELEGRAM_BOT_TOKEN` in production. The plan (What We're NOT Doing) and `deploy-plan.md` say the token exists only in `.dev.vars` and that the poller is not deployed.
- **Fix**: Replace the clause with a pointer to `context/deployment/deploy-plan.md`, where the production prerequisites are listed.
- **Decision**: FIXED — README points to context/deployment/deploy-plan.md instead of `wrangler secret put`.

### F5 — Chat ID ownership not verified; test endpoint has no limit

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/settings/telegram-test.ts:44, src/lib/alert-settings.ts:81-88
- **Detail**: A user can save any chat ID that has started the bot, including someone else's or a group, and send unlimited test messages there. That uses up the bot's quota, which alerts also need. The plan deliberately skipped `/start` linking. The app is invite-only (S-01), which limits the risk.
- **Fix**: Add a backlog item to the roadmap for chat linking via `/start <code>` and a cooldown on the test endpoint. Leave the code alone in this change.
- **Decision**: FIXED — new Parked entry in context/foundation/roadmap.md (chat linking via /start <code> + test endpoint limit).

### F6 — Test message error shown away from its button

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/settings.astro:54-69
- **Detail**: Test success (`?telegram=sent`) appears in the test form, but a test error comes back as `?error=`, which `AlertSettingsForm` shows above the "Save settings" button. The user may think saving the settings failed.
- **Fix**: Redirect test errors to `?telegram_error=` and show them in the test form, next to the success message.
- **Decision**: FIXED — telegram-test redirects with ?telegram_error=, shown in the test form; smoke updated.

### F7 — Chat ID regex rejects 16-digit IDs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/alert-settings.ts:9
- **Detail**: `^-?\d{1,15}$` stays within JS safe integers. But Telegram allows IDs up to 52 bits (up to 16 digits, still safe in JS). Today's IDs are 10–13 digits, so nobody is affected yet.
- **Fix**: Allow `\d{1,16}` and add a `Number.isSafeInteger` check after parsing.
- **Decision**: FIXED — pattern \d{1,16} plus Number.isSafeInteger in parseAlertSettingsForm.

### F8 — pgTAP for alert_notifications skips update/delete

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/alert_notifications_rls.sql
- **Detail**: Unlike `cron_runs_rls.sql:63-83`, the test does not check that `authenticated` cannot `update` or `delete`. `revoke all` already blocks both, so this is a gap in test coverage, not in security.
- **Fix**: Add two `throws_ok` assertions (update and delete as `authenticated`, code `42501`) and increase `plan(N)`.
- **Decision**: FIXED — update/delete assertions added, plan(9).
