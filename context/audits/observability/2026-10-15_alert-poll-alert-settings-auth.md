---
type: observability-audit
date: 2026-10-15 12:59
mode: audit
commit: b6ff771
branch: master
dirty_tree: true
areas: [alert-poll, alert-settings, auth]
area_source: foundation
runtime_proof: not-run
error_tracker: none (Cloudflare Workers Logs via wrangler.jsonc observability.enabled)
previous_report: null
findings: { critical: 3, high: 9, medium: 18, low: 10 }
---

# Observability audit — alert-poll, alert-settings, auth (2026-10-15)

Dirty tree at audit time: only `.claude/` skill files, `CLAUDE.md` and two untracked E2E specs; no audited `src/` file was modified.

## 1. TL;DR

- **Supabase errors are read as "data or nothing".** `getUser()` and PostgREST return `{ error }` instead of throwing, and several call sites never read or log it. A Supabase Auth outage silently signs every user out (`src/middleware.ts:16-21`), and settings/dashboard read failures render as quiet 200 pages.
- **The cron path is "never throws" and squeezes every failure into one string.** A failed run is logged with `console.log` (info level), truncated to 500 chars, and the invocation outcome is always "ok" (`src/workers/scheduled.ts:57-83`, `src/lib/cron-runs.ts:17-27`).
- **Every log line is a message-only template string.** Stacks, `cause`, PostgREST `code/details/hint`, HTTP status, user reference and request id never reach Workers Logs (11 sites, 0 log calls passing an error object).
- **Graceful degradation leaves no signal.** If adsb.fi changes its field names, every run finishes `status=ok` with 0 matches. An adsbdb outage looks like "route unknown". At the same time, one user who blocked the bot keeps every run in `status=error` forever, so the real failures drown in noise.
- **Most important consequence:** the alert loop can stop delivering (upstream schema drift, all users filtered out, adsbdb down) while the dashboard heartbeat stays green and nothing at error level appears in any log.

## 2. Capture model

**Runtime.** One Cloudflare Worker (`src/worker.ts:6-9`) exports Astro's `fetch` handler (`@astrojs/cloudflare/handler`) and `scheduled: handleScheduled`. Neither is wrapped. `wrangler.jsonc` has no `triggers.crons`, so the schedule lives outside the repo (locally, `npm run cron:local`).

**Error tracker.** None. No Sentry/OTel/other SDK in `package.json`, and no client-side handler. The only pipeline is Workers Logs (`wrangler.jsonc` `observability.enabled: true`, no `head_sampling_rate`), which records `console.*` output and invocation outcomes.

**Capture boundaries (in repo).**

- Astro wraps middleware and page/endpoint rendering in one try/catch (`node_modules/astro/dist/core/routing/handler.js:59-108`). On a throw, line 102 logs `err.stack` as a single flat `console.error` string, with no path, method or `cause`. It then renders a 500. There is no `src/pages/500.astro`, so the body is empty (`core/errors/default-handler.js:105`). The handler returns normally, so the invocation outcome is "ok" with status 500.
- Errors thrown after the first streamed byte (child components, React island SSR) go to `runtime/server/render/astro/render.js:66-72`. That code calls `controller.error(e)` with no Astro log; the status is already 200 and the HTML is truncated.
- Server code in `src/` contains **zero** `throw` statements. Supabase calls never use `.throwOnError()`. So Astro's catch-and-log fires only for genuine crashes.
- `handleScheduled` is "never throws" by contract (`scheduled.ts:31`). Every failure ends as a log line plus a `cron_runs` row, so the scheduled invocation outcome is always "ok".
- **Client side:** no `window.onerror`/`unhandledrejection` handler, no React error boundary, and `@astrojs/react` calls `hydrateRoot` without `onUncaughtError`/`onRecoverableError` (`node_modules/@astrojs/react/dist/client.js:105`).

**Logging.** No logger module. There are 11 `console.error/warn` sites, all of them template strings carrying `.message` only:

- `scheduled.ts:42,46,67,77,85`
- `settings.ts:34`, `pause.ts:36`, `telegram-test.ts:39,59`
- `aircraft-types.ts:44`, `settings.astro:61`

The per-run summary is a `console.log` (`scheduled.ts:80-83`). Helpers `describeError` (`scheduled.ts:25-27`), `describeRunOutcome` (`cron-runs.ts:17-27`) and `describeFetchError` (`telegram.ts:14-23`) all reduce an error to its message.

**In-app signal.** The `cron_runs` table (status, plus `error` text capped at 500 chars) feeds the dashboard heartbeat, which goes stale after 5 min (`cron-runs.ts:40`, `dashboard.astro:26-48`). The `error` column is hidden from `authenticated` (`supabase/migrations/20260929065324_cron_runs_hide_error.sql`), so users see only "(last run failed)".

**Scrubbing.** The poller names users by their position in the run, by design (`alert-poller.ts:4-5,110`). `telegram.ts` redacts the bot token from the message, which is correct and harmless. Nothing else is scrubbed.

**Deploy identity.** No `version_metadata` binding (`Env` is empty in `worker-configuration.d.ts`), no environment tag, no request id (`cf-ray` is never read from the incoming request), and no `upload_source_maps`.

**Assumptions (outside the repo, not findings; all unconfirmed):**

- Workers Logs collection is on in production at 100% sampling.
- Whether any alert/notification exists on top of Workers Logs, or on Cron Events, is unknown.
- The production cron trigger is configured in the Cloudflare dashboard, and `wrangler deploy` preserves it.
- Production secrets (`SUPABASE_*`, `TELEGRAM_BOT_TOKEN`) are set via `wrangler secret`.
- Supabase-side Auth/PostgREST logs and their alerting are outside this audit.
- Whether workerd logs an error when a response body stream errors after headers (finding X2) was not verified.

## 3. What reaches the logs (static analysis, no runtime probes)

| Failure shape                                                | Response                        | Workers Logs                                        | Verdict  |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------- | -------- |
| Throw in page frontmatter / endpoint                         | 500, empty body                 | flat stack string, no path/user, outcome "ok"       | poor     |
| Throw in island/child SSR after first byte                   | 200, truncated HTML             | nothing from app code                               | missed   |
| Middleware throw (e.g. malformed `SUPABASE_URL`)             | 500 on every request            | flat stack                                          | good-ish |
| Supabase Auth outage (`getUser` → `AuthRetryableFetchError`) | 302 → /auth/signin for everyone | request line only                                   | missed   |
| Sign-in GoTrue 5xx / 429                                     | 302 with raw message in URL     | request line only                                   | missed   |
| PostgREST error on settings save/pause                       | 303 `?error=save_failed`        | message-only `console.error`                        | poor     |
| PostgREST error on settings/dashboard read                   | 200 with UI text                | nothing                                             | missed   |
| Settings row missing (trigger failed)                        | 303/200 "contact support"       | nothing                                             | missed   |
| Cron run crashes inside `runAlertPoll`                       | —                               | `console.log` with message ≤500 chars, outcome "ok" | poor     |
| Per-user poll failures                                       | —                               | joined into one ≤500-char string at info level      | poor     |
| adsb.fi returns reshaped fields                              | —                               | `status=ok`, `matches: 0`                           | missed   |
| adsbdb outage / 5xx / timeout                                | alert says "route unknown"      | nothing                                             | missed   |
| Client fetch / hydration error                               | UI fallback text                | nothing                                             | missed   |

## 4. Systemic root causes

**RC1 — Supabase result tuples are read as "data or nothing", with no shared error helper.**

- **Mechanism:** postgrest-js defaults to `shouldThrowOnError=false`, and auth-js returns errors instead of throwing (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2716-2724`). Each call site decides on its own.
- **Unread or unlogged sites:**
  - `src/middleware.ts:16-21`: `getUser` error dropped
  - `src/pages/api/auth/signout.ts:7`: result ignored
  - `src/pages/dashboard.astro:36-38,51-53`
  - `src/pages/settings.astro:35-40`
  - `src/pages/api/auth/signin.ts:15-16`
  - zero-row branches in `settings.ts:39`, `pause.ts:40`, `telegram-test.ts:42`
- **Why it exists:** a reasonable "keep the page usable" choice, made without a matching log line.
- **Explains:** A1, A2, A6, A7, S1, S2, S3, X3.

**RC2 — The "never throws" cron contract plus string-collapsed run errors.**

- **Mechanism:**
  - `scheduled.ts:57-59` catches everything and maps it through `describeRunOutcome`, which keeps message only, capped at 500 chars (`cron-runs.ts:18-24`).
  - `scheduled.ts:80-83` logs the result with `console.log`, even when `status=error`.
  - Per-user errors are `"user N: …"` strings (`alert-poller.ts:110`).
- **Why it exists:** so a cron failure cannot take down request serving, and so `cron_runs` stays bounded. Both goals are fine; the loss of severity, stack and the full list is not needed for either.
- **Explains:** P2, P3, P5, P10, P13.

**RC3 — Message-only string logging, no structured logger.**

- **Mechanism:** every `console.error` interpolates `error.message` (the 11 sites in §2). The fetch helpers drop `cause` (`telegram.ts:14-23`, `adsb.ts:159-166`). Upstream diagnostics that are collected get discarded (`alert-poller.ts:121-128` vs `adsb.ts:194-206`).
- **Never reaches the log:** stack, `cause`, PostgREST `code/details/hint`, HTTP status, user reference, `cf-ray`.
- **Explains:** P6, P8, P12, S4, S5, S8, S11, X1, X3.

**RC4 — Degradation without a counter; expected and unexpected failures share one status.**

- **Mechanism:**
  - The poller counts outcomes (`polled`, `matches`, `sent`) but not inputs: aircraft seen, `skipped` from `parseAdsbResponse` (`adsb.ts:133-151`, never read in `alert-poller.ts`), excluded users, route-lookup failures (`routes.ts:88-96` → `null`).
  - Meanwhile any single per-user error, including permanent Telegram 400/403, makes the whole run `status=error` (`cron-runs.ts:23-24`, `alert-poller.ts:183-193`).
- **Result:** "nothing could happen" looks like "nothing happened", and "one user blocked the bot" looks like an outage.
- **Explains:** P1, P4, P7, P9, P11.

**RC5 — Failures turned into ordinary responses, with raw provider text in two places.**

- **Mechanism:**
  - The project convention redirects with an error code (CLAUDE.md, `src/lib/form-errors.ts`), so a server failure is a 302/303 or a 200 page.
  - Sign-in breaks the convention by putting raw `error.message` in the URL and rendering `?error=` verbatim (`signin.ts:16`, `pages/auth/signin.astro:5`). `settings.astro:36` renders raw PostgREST text.
  - Framework edges are uncustomized: no 500 page, no request-context wrapper in `worker.ts`, streaming on, no client error hooks.
- **Explains:** A2, A3, A4, S6, S7, X1, X2.

## 5. Findings by area

### Alert poll

| #   | Location                                                                  | Category            | Severity | What happens in production                                                                                                                                                                                                                                                                        | Fix direction                                                                                                                                |
| --- | ------------------------------------------------------------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `src/workers/alert-poller.ts:120-145`; `src/lib/adsb.ts:105-151`          | coverage-gap        | critical | adsb.fi renames or reshapes `lat/lon/t/track/gs/seen_pos` → aircraft are skipped, or have `type=null` / no prediction → `ok:true`, 0 matches. The run is `status=ok`, the heartbeat stays fresh, and no user ever gets an alert. Nobody can see it.                                               | Add `aircraftSeen`, `skipped` and per-reason counts to the summary; log an error when `polled>0` and every aircraft was skipped or unusable. |
| P2  | `src/workers/scheduled.ts:80-83`; `src/lib/cron-runs.ts:24`               | logged-not-captured | critical | A failed run is a `console.log` (info) line whose error text is already truncated to 500 chars. An error-level filter never sees poll failures, and after about 5–8 user errors the rest are recorded nowhere.                                                                                    | `console.error` when `status=error`; log the untruncated `summary.errors` as structured entries; keep truncation only for the DB column.     |
| P3  | `src/workers/scheduled.ts:57-59`; `src/lib/cron-runs.ts:18-21`            | identity-lost       | high     | A bug inside `runAlertPoll` (TypeError, client throw) becomes `.message` only, with no stack or `cause`, at info level, and the invocation outcome stays "ok".                                                                                                                                    | `console.error("[cron] run crashed", error)` with the object; rethrow after bookkeeping so the platform records an exception.                |
| P4  | `src/workers/alert-poller.ts:183-193`; `src/lib/cron-runs.ts:23-24`       | noise               | high     | One user who blocked the bot (403) or has a bad chat id (400) → every run with matching aircraft is `status=error`, and the dashboard permanently shows "(last run failed)". Real outages look the same, and the 500-char budget is spent on the repeat.                                          | Split run-level errors from per-user permanent conditions; store a per-user `telegram_failed_at`/reason and show it in /settings.            |
| P5  | `src/workers/alert-poller.ts:110` (comment at :4-5)                       | missing-context     | medium   | "user 3" is a position in a filtered list and shifts whenever anyone pauses or is added. Failures cannot be followed across runs or matched to a support request.                                                                                                                                 | Log a stable pseudonymous reference (hash or 8-char prefix of `user_id`), never coordinates or chat id.                                      |
| P6  | `src/workers/alert-poller.ts:121-128` vs `src/lib/adsb.ts:194-206`        | identity-lost       | high     | `upstream` (`server`, `cf-ray`, `retry-after`, start of body), built specifically to tell a block from a rate limit, is dropped. Production cannot tell a WAF block from a 429 or an origin error.                                                                                                | Include `httpStatus`, `durationMs` and `upstream` in the logged failure.                                                                     |
| P7  | `src/workers/alert-poller.ts:123-125`                                     | missing-context     | medium   | A 4xx breaks the loop with one error that does not say how many users were skipped. If the egress IP is blocked, every run polls user 1 only, which reads as "one user's problem".                                                                                                                | Record `skippedUsers` in the error and summary (as the Telegram 429 path already does at :107).                                              |
| P8  | `src/workers/alert-poller.ts:204-216`                                     | identity-lost       | high     | A failed `alert_notifications` insert → the alert was sent but not remembered → the same aircraft is re-alerted every minute. The only evidence is a message inside the truncated run string, so a `23514` and a network error look alike. `aircraft.type ?? ""` (:209) hides a broken invariant. | Log the PostgrestError (`code/details/hint`) with stage and hex; count `unrecorded`; treat a null type as a bug.                             |
| P9  | `src/lib/routes.ts:88-96`; `alert-poller.ts:174-175`                      | swallowed           | medium   | adsbdb outage, 429, 5xx, timeout or schema change → `null` → users quietly get "Route unknown". The only trace is a lower `routes` count.                                                                                                                                                         | Return a failure kind next to `null` and count route failures by kind in the summary.                                                        |
| P10 | `src/workers/scheduled.ts:39-48,66-68`; `src/pages/dashboard.astro:90-94` | missing-context     | medium   | Missing `SUPABASE_SERVICE_KEY` (logged only at warn), a malformed URL or a failed `cron_runs` insert → no row → the dashboard says "is `npm run cron:local` running?", pointing at the wrong cause.                                                                                               | Log a missing key at error level; make the stale hint neutral ("no run recorded").                                                           |
| P11 | `src/workers/alert-poller.ts:55-84`                                       | missing-throw       | medium   | Users with empty `aircraft_types`, or with no home or chat id, are dropped without being counted. A wrong filter yields `users: 0`, `status=ok`. "Saved but never alerted" is indistinguishable from "not eligible".                                                                              | Log eligible vs excluded counts by reason; warn when `users === 0` but non-paused rows exist.                                                |
| P12 | `src/lib/telegram.ts:14-23,42-63`; `src/lib/adsb.ts:159-166,198-217`      | identity-lost       | medium   | Telegram `error_code` and `retry_after` are dropped; network `cause` (DNS/TLS/reset) is lost in both clients; for invalid JSON from adsb.fi the parse error and body start are dropped.                                                                                                           | Carry `retryAfter`, a redacted `cause` and the start of the body in the failure objects.                                                     |
| P13 | `src/workers/scheduled.ts:50-83`                                          | coverage-gap        | medium   | Nothing is logged at the start of a run. A Worker cancelled partway (runs last about 1.1 s/user plus 10 s timeouts) leaves no row and no line; overlapping runs cannot be told apart.                                                                                                             | Log a start line with a run id; put the run id in every line and in the `cron_runs` row.                                                     |
| P14 | `src/pages/api/adsb/probe.ts:48-49,61-63`                                 | logged-not-captured | low      | The diagnostic endpoint returns 500/502 detail only in the response body.                                                                                                                                                                                                                         | `console.error` the structured result before returning.                                                                                      |

### Alert settings

| #   | Location                                                                                                                     | Category        | Severity | What happens in production                                                                                                                                                                                                                           | Fix direction                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| S1  | `src/pages/settings.astro:35-36`                                                                                             | swallowed       | high     | A PostgREST outage, `42501` or JWT error on load → 200 page showing "Could not load your settings: <raw message>", with no log. The entry point of the flow fails without a trace on the server.                                                     | Log a structured error (code, details, user ref); show a catalog message (`load_failed`); return 5xx.     |
| S2  | `settings.astro:37-40`, `api/settings.ts:39-41`, `api/settings/pause.ts:40-42`, `api/settings/telegram-test.ts:42-44`        | swallowed       | high     | A missing `alert_settings` row (the `handle_new_user` trigger failed) → "contact support" on a 200/303, logged in none of the four places. Broken provisioning stays hidden until a user writes in.                                                  | Log a "settings row missing" event at error level with the user ref in all four places.                   |
| S3  | `src/pages/dashboard.astro:36-38,51-53`                                                                                      | swallowed       | medium   | The heartbeat read error becomes "Cron status unavailable." and the settings read error becomes "Alert status unavailable." with no pause switch, with no log. The card built to detect a silent cron fails silently itself.                         | Keep the graceful UI; `console.error` both read errors with their codes.                                  |
| S4  | `src/pages/api/settings.ts:32-35`; `src/pages/api/settings/pause.ts:34-37`                                                   | identity-lost   | high     | Outage, RLS denial, CHECK violation (client and server validation drifting from the DB) and expired JWT all become `save_failed` ("try again") plus a message-only log. Telling "DB down" from "schema drift rejects every save" means parsing text. | Log `{code, details, hint, userRef}`; map `23514/23502/22P02` to their own code logged at error level.    |
| S5  | `src/pages/api/settings/telegram-test.ts:54-61`; `src/lib/form-errors.ts:32-41`                                              | missing-context | medium   | `telegram_chat_not_found` and `telegram_blocked` are never logged. A wrong or swapped bot token makes every user see "check the chat ID". A 401 (revoked token) is logged like a transient failure, and `httpStatus` is dropped.                     | Log every non-ok result with `httpStatus` and the derived code; treat Bot API 401/404 as a config error.  |
| S6  | `src/components/settings/AircraftTypePicker.tsx:49-56,94-98`                                                                 | swallowed       | medium   | Session expiry (`opaqueredirect`), 500, 503, abort, bad JSON and contract drift all become "Search is unavailable right now". Only the 500 leaves a server log line.                                                                                 | Keep the error kind in state and show "session expired, reload" for redirects; add a client error beacon. |
| S7  | `@astrojs/react` `hydrateRoot` (no error callbacks); `src/layouts/Layout.astro` (no global handler); `AlertSettingsForm.tsx` | coverage-gap    | low      | If an island fails to hydrate, the form can still post its SSR initial values and report "Settings saved." Nothing leaves the browser.                                                                                                               | Add a tiny `error`/`unhandledrejection` beacon or a logging error boundary.                               |
| S8  | `src/pages/settings.astro:59-62`                                                                                             | identity-lost   | low      | Aircraft-type names failing to load → degraded UI on a 200 plus a message-only log with no code or user.                                                                                                                                             | Structured log with the PostgREST code.                                                                   |
| S9  | `src/pages/api/settings.ts:22-24`; `pause.ts:23-25`                                                                          | coverage-gap    | low      | A server-side validation rejection means JS is off, hydration failed or validation drifted, and it is never recorded.                                                                                                                                | Log at info/warn with the validation code only.                                                           |
| S10 | `src/lib/form-errors.ts:22-27`                                                                                               | missing-context | low      | An unknown `?error=` code renders generically with no trace, so a code added to an endpoint but missing from the catalog goes unnoticed.                                                                                                             | Type redirect helpers to `keyof ERROR_MESSAGES`, or warn on unknown codes.                                |
| S11 | `src/pages/api/aircraft-types.ts:41-44`                                                                                      | identity-lost   | low      | When both queries fail, only the first error's message is logged.                                                                                                                                                                                    | Log both, with codes.                                                                                     |
| S12 | `src/pages/api/settings/telegram-test.ts:26-28`                                                                              | missing-context | low      | A missing `TELEGRAM_BOT_TOKEN` shows up only when a user clicks "Send test" (303, no log), although the same gap breaks every poll.                                                                                                                  | Log it at error level here (the poller already records it in `summary.errors`).                           |

### Auth / access

| #   | Location                                                                                                                              | Category           | Severity | What happens in production                                                                                                                                                                                                                                                                | Fix direction                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `src/middleware.ts:16-21`                                                                                                             | swallowed          | critical | `getUser()` returns `{user:null, error}` on an Auth outage, 5xx, 429, network failure or a rotated anon key (`GoTrueClient.js:2716-2724`). The error is dropped, so every signed-in user is 302'd to sign-in (form POSTs lost). Responders see a burst of ordinary 302s and nothing else. | Treat `AuthSessionMissingError` as anonymous; log anything else at error level with name, status and code; answer 503 for retryable errors. |
| A2  | `src/pages/api/auth/signin.ts:15-16`                                                                                                  | flattened-response | high     | Wrong password and GoTrue 5xx, rate limit or network failure take the same path: a redirect with the raw message in the URL and no log. `status` and `code` are dropped.                                                                                                                  | Map to catalog codes; `console.error` everything except `invalid_credentials`, with status and code (never the email).                      |
| A3  | `src/pages/auth/signin.astro:5`; `src/components/auth/ServerError.tsx:14`                                                             | missing-context    | medium   | `?error=` is rendered verbatim, breaking the code-only convention. User reports quote text that has no code to grep for, and anyone can craft a link that shows any text.                                                                                                                 | Pass codes only; add `signin_failed`, `auth_unavailable`, `rate_limited`, `invalid_credentials` to `form-errors.ts`.                        |
| A4  | `src/lib/supabase.ts:7-9`; `astro.config.mjs:19-21` (`optional: true`); `src/middleware.ts:22-23`; `src/lib/config-status.ts`         | missing-context    | high     | A deploy that drops Supabase secrets boots fine. Every private route redirects to sign-in, sign-in says "Supabase is not configured", the cron only `warn`s, and there is no error-level line anywhere.                                                                                   | Log once per isolate at error level when configuration is missing outside dev, or make the variables required for production builds.        |
| A5  | `src/middleware.ts:25-26`                                                                                                             | missing-context    | medium   | Revoked or reused refresh token, corrupted cookie chunks and expired session (with a lost form POST) all become a reason-less redirect. A "login works, then I'm bounced back" loop leaves no trace.                                                                                      | Log at info/warn when a request carrying `sb-*` cookies is redirected, with path, method and error name.                                    |
| A6  | `src/pages/api/auth/signout.ts:7`                                                                                                     | swallowed          | medium   | On a `/logout` 5xx, auth-js clears local cookies but the server-side revoke did not happen, so the refresh token stays valid. Nobody sees it.                                                                                                                                             | Read `error` and log it (ignore session-missing/401/404); keep the redirect.                                                                |
| A7  | `src/pages/settings.astro:37-40`; `src/pages/dashboard.astro:50-53`                                                                   | flattened-response | medium   | If the page's own client loses its session (failed refresh → runs as `anon`), RLS returns 0 rows. The page then says "settings record missing, contact support", blaming provisioning for an auth problem.                                                                                | Check the session before reporting "missing"; log the missing-row case (see S2).                                                            |
| A8  | `src/lib/supabase.ts:12-14` plus one client per call site (`middleware.ts:14`, `dashboard.astro:21`, `settings.astro:23`, API routes) | missing-context    | medium   | The middleware refreshes and writes new cookies, but the page's second client reads the original `Cookie` header and refreshes again. Usually the reuse window hides this; otherwise "refresh token already used" → anon → A7/A5, with nothing logged.                                    | Create the client once in the middleware and pass it through `locals`, or have `getAll` prefer cookies already set on `context.cookies`.    |
| A9  | `src/middleware.ts:13-19`                                                                                                             | noise              | low      | `getUser()`, a GoTrue network call, runs on public routes too, so during an Auth outage even the sign-in page waits for the failure. Latency is not recorded.                                                                                                                             | Skip on public routes, or log duration and error once A1 is fixed.                                                                          |
| A10 | `src/pages/api/auth/signin.ts:19`                                                                                                     | missing-context    | low      | Sign-in success and failure are never logged with a user ref or request id, so "user X can't log in" has no timeline.                                                                                                                                                                     | One structured `auth.signin.ok/fail` line with user ref and `cf-ray`.                                                                       |

### Platform / plumbing

| #   | Location                                                                                             | Category        | Severity | What happens in production                                                                                                                                                         | Fix direction                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | `node_modules/astro/dist/core/routing/handler.js:102`; no `src/pages/500.astro`; `src/worker.ts:6-9` | missing-context | medium   | A crash in a page or endpoint gives an empty 500 and one flat stack string with no path, method, user, `cause` or version; the invocation outcome is "ok".                         | Add a 500 page; wrap `fetch` (or the middleware around `next()`) to log `{path, method, ray, err}` as an object.                        |
| X2  | `node_modules/astro/dist/runtime/server/render/astro/render.js:66-72` (streaming on by default)      | coverage-gap    | medium   | An SSR throw in a child component or React island after the first byte → 200 with truncated HTML and no app log.                                                                   | Keep data loading in frontmatter, or set `streaming: false` for these small pages.                                                      |
| X3  | the 11 `console.error/warn` sites in §2                                                              | identity-lost   | medium   | Network failure vs RLS denial vs constraint violation are indistinguishable except by message wording. PostgREST puts network stack and cause in `details`, which is never logged. | Add one `logError(event, err, ctx)` helper that emits structured JSON: `event`, `pgCode`, `details`, `hint`, `cause`, `userRef`, `ray`. |
| X4  | `wrangler.jsonc` (no `version_metadata`, no `upload_source_maps`); no request id                     | missing-context | low      | Log lines cannot be tied to a deploy; stacks point at bundle paths; dev and prod lines are identical.                                                                              | Add a `version_metadata` binding and log its `id`; set `upload_source_maps: true`; include `cf-ray`.                                    |

## 6. Recommended fix order

1. **Middleware: branch on the `getUser()` error (A1, A5, partly A9).** A small change that closes the only invisible mass-outage path for every user. Expected `AuthSessionMissingError` must not be logged, otherwise every anonymous request becomes noise.
2. **Shared `logError(event, err, ctx)` helper, adopted at every failure branch (RC1 + RC3).** Closes or improves S1, S2, S3, S4, S5, S8, S11, A2, A6, A7, P8, P12, P14, X3.
   - Emit one JSON object per event: a stable `event` name, PostgREST `code/details/hint`, the `cause` chain, `userRef` and `cf-ray`.
   - **Privacy constraint:** `userRef` must be a hash or prefix of `user_id`; never log email, home coordinates, chat id or bot token (keep the existing `telegram.ts` redaction).
3. **Cron outcome and run identity (RC2).** Closes P2, P3, P5, P10, P13.
   - Log at `console.error` when `status=error`, with untruncated errors as one line each, a run id and a stable `userRef`.
   - Pass the error object when the run crashes; consider rethrowing after bookkeeping so the invocation outcome becomes "exception".
   - **Double-reporting constraint:** if the run rethrows, the summary line and the exception will both appear. Use the run id to tie them together.
4. **Poll input counters and a split between per-user and run-level failures (RC4).** Closes P1, P4, P7, P9, P11.
   - Count aircraft seen and skipped, excluded users and route failures; flag "all skipped" as an error.
   - Move permanent per-user Telegram failures out of the run `status` and into per-user state.
5. **Sign-in error codes (RC5).** Closes A2 and A3 through `form-errors.ts`, matching the existing settings convention.
6. **Framework edges.** Closes X1, X2, S6, S7, A4, X4: a 500 page plus a request-context wrapper, a streaming decision, a client error beacon, required production secrets, and a version tag.

## 7. Changes since last audit

First audit; no previous report.

## 8. Method and limits

- **Agents:** four read-only subagents ran in parallel: alert-poll, alert-settings, auth, and cross-cutting plumbing. All of them were given the capture model above. Duplicates across areas were merged:
  - the `getUser` error appeared in 3 reports → A1
  - dashboard read errors appeared in 3 → S3
  - `settings.astro` load error appeared in 3 → S1
  - the missing-row branches → S2
  - message-only logging → X3 / RC3
- **Severity changes:** I lowered P5 (user by position) from high to medium (missing-context) and S1 from critical to high, because a DB outage also surfaces in the poller's `cron_runs`. I dropped the auth agent's `setAll` Cache-Control finding (a caching/security concern, not observability).
- **Spot-checked by hand, all confirmed:**
  - `parseAdsbResponse` counts `skipped` (`adsb.ts:133-151`), but `alert-poller.ts` never reads it (grep).
  - `getUser()` returns `{user:null, error}` and does not throw (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2702-2724`).
  - `settings.astro:35-36` renders `error.message` and does not log it.
  - `AircraftTypePicker.tsx:94` discards the rejection.
  - `signout.ts:7` ignores the result.
  - `signin.astro:5` reads the raw `?error=`.
  - Astro `routing/handler.js:102` logs `err.stack` as a flat string.
  - `render.js:66-72` errors the stream with no log.
  - `scheduled.ts:80-83` logs the run outcome with `console.log`.
  - `dashboard.astro:92` stale hint names `npm run cron:local`.
- **Runtime proof: not run.** All findings are static only. A probe suite (fake ingest via `.claude/skills/10x-observability-audit/scripts/fake-ingest.mjs`, isolated worktree, `?probe=<id>` injections) would be most valuable for A1, P1, P2/P3 and X2. No harness exists yet.
- **Repo-wide sweep** (`src/` + `scripts/`, excluding tests, `ui/`, fakes and generated types):
  - 7 catches with no binding or an empty body (2 in `src/`: `adsb.ts:198` justified, `routes.ts:94`)
  - 1 promise rejection handled by discarding the error
  - 11 message-only `console.error/warn` calls
  - 0 log calls passing an error object
  - 0 uses of `cause` in `src/`
  - 4 `new Error` without `cause`
  - 9 Supabase calls whose `{error}` is unread, or read but not logged
- **Not verifiable from the repo:** how Workers Logs renders the lines, whether alerting exists, the production cron trigger configuration, and Supabase-side logs.
