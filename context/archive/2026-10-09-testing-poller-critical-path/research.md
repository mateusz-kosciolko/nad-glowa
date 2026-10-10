---
date: 2026-10-09T19:53:49+0200
researcher: Mateusz Kościółko (with Claude Code)
git_commit: cbb2457
branch: master
repository: 10x
topic: "Ground test-plan rollout Phase 1 (Poller critical path): risks #1, #2, #4"
tags: [research, testing, poller, alert-poller, scheduled, flyover, alerts, dedup]
status: complete
last_updated: 2026-10-09
last_updated_by: Mateusz Kościółko (with Claude Code)
---

# Research: Test rollout Phase 1 — poller critical path (risks #1, #2, #4)

**Date**: 2026-10-09T19:53:49+0200
**Researcher**: Mateusz Kościółko (with Claude Code)
**Git Commit**: cbb2457 (working tree adds only untracked `context/` files; no source changes)
**Branch**: master
**Repository**: 10x

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` ("Poller critical path"). For risks #1, #2 and #4 from §2:
find the real failure path in code, quote the relevant lines, verify or correct the response guidance, locate existing
tests, pick the cheapest useful test layer, and flag speculative risks or misleading hot-spot evidence. Also decide the
poller integration layer: Node with injected edges or local Supabase.

## Summary

- **Entry point and edges.** A cron tick runs `handleScheduled` (`src/worker.ts:8`). It builds the service_role client,
  calls `runAlertPoll(supabase, () => new Date())`, and writes one `cron_runs` row (`src/workers/scheduled.ts:11-13`,
  `:55-70`). The poller has four external edges. Three of them go through the global `fetch` with fixed hosts: ADS-B
  (`src/lib/adsb.ts:17,186`), adsbdb (`src/lib/routes.ts:4,84`) and Telegram (`src/lib/telegram.ts:4,36`). The fourth
  is Supabase, which comes in as a **parameter** (`src/workers/alert-poller.ts:43`). The one non-injectable input is
  `TELEGRAM_BOT_TOKEN` from `astro:env/server` (`src/workers/alert-poller.ts:6,46`). Vitest in Node cannot resolve it,
  so a test needs a small refactor (pass the token in) or a test-only alias.
- **#1: guidance holds, with one correction.** Every failure _reported_ by an edge client ends up in
  `summary.errors` and then in `cron_runs.status='error'`. But a whole class of failures looks exactly like empty sky:
  ADS-B data that parses yet cannot match. Entries the parser rejects are counted in `skipped`, and the poller ignores
  that count. Aircraft without a type, track or speed are dropped silently. `cron_runs` stores no counts, so "0
  matches" and "0 users" look the same in the stored trace. Only the log line tells them apart.
- **#2: guidance is partly wrong and must be corrected before planning.** (a) "Same airframe, different callsign →
  nothing" holds at the pure-function level. The two-run path needs an integration test because the dedup memory is a DB
  row written _after_ the send. (b) "A permanent send error does not create a new attempt every minute" is **not**
  what the code does, and not what was decided. The accepted fix (archive impl-review F1, Fix A) caps 400/403 at one
  attempt per user **per run**. The next run tries again because no row is written. A test that asserts "no attempt in
  the next minute" would fail against accepted behaviour. Stopping retries for good is the rejected Fix B: a product
  decision with a migration. (c) Two dedup gaps exist by design: a `~` (TIS-B) address without a registration, and an
  "alert sent but not recorded" result. Both can repeat an alert every minute. (d) Overlapping runs are a known, parked
  gap and do not belong in Phase 1 tests.
- **#4: "existing unit tests already cover this" is mostly true for the PRD boundaries, with one real oracle gap.**
  Six existing tests in `src/lib/flyover.test.ts` cover the four boundaries the PRD names: just outside the radius,
  <2 min, >15 min and on ground. Every distance test puts home on the **equator** (`src/lib/flyover.test.ts:11-12`),
  where `cos(lat) = 1`. So a bug that drops or misplaces the `cos(home.lat)` factor (`src/lib/flyover.ts:62`) would pass
  every distance and radius assertion. The two lead-time-boundary fixtures are searched until `predictPass` returns the
  boundary value (`src/lib/flyover.test.ts:49-69`): an oracle borrowed from the function. Type matching, the other half
  of "the match rule", lives in the poller (`src/workers/alert-poller.ts:132`) and has no tests.
- **Cheapest layers.** #4: a Vitest unit boundary table in the existing `npm test` run, with expectations derived from
  geometry or the PRD at a realistic latitude. #1 and #2: Vitest in Node, driving `runAlertPoll` with `fetch` stubbed by
  host and an in-memory fake of the Supabase edge, in a **separate** config or command (the `npm test` contract excludes
  modules that import `astro:*`). Local Supabase is _not_ recommended for Phase 1. It needs a deliberate exception to
  the service_role hard rule and gives no extra signal for the scenarios in scope (details below).
- **Hot-spot evidence is misleading for #4.** The `src/lib` churn comes mainly from `alert-settings.ts`, `adsb.ts` and
  `routes.ts`. `flyover.ts` has exactly one commit in the 30-day window (its creation). The likelihood of #4 rests on PRD
  criticality, not on churn. For #1 and #2 the churn evidence is real: `scheduled.ts` 5 commits, `alert-poller.ts` 4,
  `adsb.ts` 3.

## Detailed Findings

### Run path and the "run trace" (context for #1 and #2)

- The trace has two parts. (1) One `cron_runs` row per run with `started_at, duration_ms, status, error`
  (`src/workers/scheduled.ts:68-70`; schema `supabase/migrations/20260928180224_cron_runs.sql:3-13`). (2) One
  `console.log` line with `users, polled, matches, duplicates, sent, routes` (`src/workers/scheduled.ts:15-24,85-88`).
  The counts exist **only** in the log line. The table has no columns for them.
- Status mapping: `summary.errors.length > 0` → `status='error'`, errors joined and cut to 500 characters
  (`src/workers/scheduled.ts:57-60`). An exception thrown out of `runAlertPoll` → `status='error'` with its message
  (`:61-64`). A constraint ties `error` to `status='error'` (`20260928180224_cron_runs.sql:12`).
- Signed-in users can read `status` but not `error` (`supabase/migrations/20260929065324_cron_runs_hide_error.sql:6-7`).
  So the dashboard shows "failed", and the reason lives in the log and in Studio.
- `handleScheduled` creates its own client through `createAdminClient()` (`src/workers/scheduled.ts:40`), so the trace
  write cannot be injected as it stands. Any test of "errors → `cron_runs` row" needs either a small seam (for example
  an exported function that takes the client and does run + record) or a module mock of `@/lib/supabase-admin`. The
  module mock goes against the spirit of the ESLint boundary (`eslint.config.js:104-124`), though the rule only catches
  `import` declarations and dynamic `import()`, not `vi.mock("…")`. This is a decision for the plan.

### Risk #1 — matching aircraft passes, no alert, trace looks like empty sky

Happy path (`src/workers/alert-poller.ts`):

```ts
131    for (const aircraft of result.aircraft) {
132      if (aircraft.type === null || !user.types.has(aircraft.type)) {
133        continue;
134      }
135      const prediction = predictPass(aircraft, user.home, user.radiusKm);
...
175      const sendResult = await sendTelegramMessage({
176        token,
177        chatId: user.chatId,
178        text: formatAlertMessage(aircraft, prediction, route, at),
179      });
```

Failures that **do** reach the trace (one `summary.errors` entry each on the inspected path):

| Failure                                                            | Where                                         | Result                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Token missing                                                      | `alert-poller.ts:46-50`                       | error, run returns early                                                            |
| Reading `alert_settings` fails                                     | `:60-63`                                      | error, run returns early                                                            |
| ADS-B non-2xx, network error, timeout, invalid JSON, no `ac` array | `adsb.ts:190-223` → `alert-poller.ts:118-126` | error per user; a 4xx also stops polling for the users left in the run (`:120-122`) |
| Reading recent alerts fails                                        | `:150-154`                                    | error, user skipped (no send)                                                       |
| Telegram send fails                                                | `:180-192`                                    | error; for 429 the rest of the run is skipped (`:103-105,183-186`)                  |
| Alert sent but insert fails                                        | `:211-213`                                    | error "may repeat next run"                                                         |
| Exception inside the poller                                        | `scheduled.ts:61-64`                          | error                                                                               |

Failures that **look like empty sky** (no error, `status='ok'`):

- **Parser drops entries.** `parseAdsbResponse` skips entries without `hex`, `lat` or `lon` and counts them in
  `skipped` (`src/lib/adsb.ts:143-150`). The poller reads only `result.aircraft` (`alert-poller.ts:131`) and never
  `result.skipped`. If the feed renames `lat`/`lon`, every aircraft is dropped and the run is `ok`.
- **Type missing or renamed.** `type` comes from field `t` (`src/lib/adsb.ts:118`). A null type never matches
  (`alert-poller.ts:132`). If `t` disappears or is renamed, nothing matches, silently.
- **Prediction inputs missing.** No track, no ground speed, or a position older than 60 s → `predictPass` returns
  `null` with no trace (`src/lib/flyover.ts:48-54`). This is correct behaviour for a single aircraft. Across a whole
  feed it would hide a format change.
- **Users excluded on purpose.** Paused users, users without home or chat ID (`alert-poller.ts:55-58`) and users with no
  types (`:68-70`) are left out without a trace. That is configuration, not failure, but `summary.users` reaching 0
  shows only in the log.

Verdict on the guidance:

- "Exactly one notification for a matching aircraft": **confirmed as the right assertion.** The oracle should be the
  Telegram request the fake captured: the `chat_id` and the text contents (type, registration, `~N min`, direction,
  `globe.adsb.fi` link). N should come from the fixture geometry, not from `formatAlertMessage`
  (`src/lib/alerts.ts:41-65`).
- "A failed fetch or send leaves an error in the run trace": **confirmed for reported failures** (table above). The
  `summary.errors` entries are the cheapest assertion point. The `cron_runs` row is one mapping step further on
  (`scheduled.ts:57-60`).
- **Correction or addition:** the response should also cover "the feed parses but yields nothing usable" (skipped
  entries, missing types). Today that is a _product gap_, not a test gap. No trace exists to assert on, so a test can
  only document today's `ok` status. Whether to surface `skipped` or "N aircraft without type" in the trace is a
  decision for `/10x-plan` or the user. It is not something Phase 1 tests can prove.
- Anti-pattern check: the poller already returns a structured summary, and the fakes can record the HTTP requests. A
  test that only asserts "`sendTelegramMessage` was called" is avoidable. Assert on the captured request body and on
  `summary.errors` / `summary.sent`.

Existing tests: none for `alert-poller.ts`, `scheduled.ts`, `adsb.ts` (parser) or `telegram.ts`. Unit tests exist only
for `alerts.ts`, `flyover.ts`, `routes.ts`, `alert-settings.ts`, `aircraft-types.ts` and `form-errors.ts` (the
`src/lib/*.test.ts` listing).

### Risk #2 — same airframe alerted again within 60 min

Dedup rule (`src/lib/alerts.ts:20-37`):

```ts
20  // Same machine means the same transponder address or the same registration, whatever the callsign.
21  // `~` addresses are not stable enough to match on; an entry exactly DEDUP_WINDOW_MS old no longer blocks.
...
27    const hexIsStable = !aircraft.hex.startsWith("~");
...
29      if (now.getTime() - new Date(entry.sent_at).getTime() >= DEDUP_WINDOW_MS) {
```

`DEDUP_WINDOW_MS = 60 * 60_000` (`src/lib/alerts.ts:7`). This matches FR-010 / PRD Business Logic: same airframe =
transponder address or registration, whatever the callsign (`context/foundation/prd.md:93-94,115`). The 60-minute
length comes from the code comment and the test plan. The PRD left it as open question 4
(`context/foundation/prd.md:135`).

Where the dedup memory lives, and the send/write order (`src/workers/alert-poller.ts`):

```ts
145    const { data: recentRows, error: recentError } = await supabase
146      .from("alert_notifications")
147      .select("aircraft_hex, registration, sent_at")
148      .eq("user_id", user.userId)
149      .gte("sent_at", new Date(at.getTime() - DEDUP_WINDOW_MS).toISOString());
...
174      // Send first, record second: a failed send leaves no row, so the next run retries it.
...
200      recent.push({ aircraft_hex: aircraft.hex, registration: aircraft.registration, sent_at: at.toISOString() });
201      const { error: insertError } = await supabase.from("alert_notifications").insert({
```

- Across runs, the dedup memory is the `alert_notifications` table (`supabase/migrations/20261005132125_alert_notifications.sql:5-15`).
  `sent_at` defaults to the database's `now()` (`:11`), which is the moment _after_ the send. Within one run, the
  in-memory `recent` array also blocks a second entry for the same machine in the same ADS-B response
  (`alert-poller.ts:198-200`).
- Dedup is per user (`.eq("user_id", …)`, `:148`). The same aircraft alerts two users once each, which matches FR-010
  ("User does not receive…").

Verdict on the guidance:

- **"Second run, same airframe, different callsign → nothing": confirmed and worth an integration test.** The pure
  function has tests for same hex, same registration under another hex, and the 59/60-minute edges
  (`src/lib/alerts.test.ts:35-60`). But "dedup works because the pure function has a test" is exactly the challenge
  the plan named. The cross-run guarantee depends on the insert payload (`hex`, `registration`), the `user_id` and
  `sent_at` query filters, and the send-then-record order. None of these is tested. The oracle for the window should
  come from FR-010: an entry 59 min old blocks, one 61 min old does not. Use the minute-level PRD value, not the exact
  `>=` boundary copied from `alerts.ts:29`.
- **"A permanent send error does not create a new attempt every minute": contradicted by the accepted decision.**
  For 400/403 the code stops _this user's remaining candidates in this run_ (`alert-poller.ts:187-190`) and writes no
  row, so the next run sends again. The archive records this tradeoff explicitly: "A blocked user still produces one
  error per run until they change their settings" (`context/archive/2026-10-05-first-advance-alert/reviews/impl-review.md:36,44`).
  What the code _does_ guarantee, and what a test can prove:
  - For 400/403: at most one send attempt per affected user per run, and the user's other candidates are not tried in
    that run.
  - For 429: no further sends to anyone for the rest of the run, with an error naming how many users were skipped
    (`:103-105,183-186`).
  - Other failures (5xx, network, timeout: `httpStatus` 5xx or `null`) carry on to the next candidate
    (`:191`) and are retried on the next run.
    Stopping retries for good (Fix B: disable the channel) is a product decision with a migration and UI work
    (`impl-review.md:38-43`). Phase 1 must not assert it.
- **Dedup gaps that exist by design** (document them, do not "fix" them in tests):
  - A `~` address with no registration never deduplicates (`alerts.ts:27,33-35`). The existing test pins that down
    (`alerts.test.ts:46-49`). A matching TIS-B target without a registration would alert on every run for as long as it
    stays inside 2–15 min. Likelihood is unverified: TIS-B entries often carry no type, and without a type they never
    match. **Speculative.** Flag for the plan as an FR-010 conflict, not as a test to write.
  - An insert that fails after a successful send → repeat next run, by design (`alert-poller.ts:211-213`).
  - Registration is compared case-sensitively as reported (`adsb.ts:119`, `alerts.ts:34`), while hex is lowercased
    (`adsb.ts:117`). Whether a feed ever changes the case of a registration was not checked. **Speculative.**
- **Overlapping runs:** read-then-write with no lock lets two overlapping runs both send. This is accepted and parked
  until the poller is deployed to a server (`context/archive/2026-10-05-first-advance-alert/reviews/impl-review.md:52-53,63`;
  `context/foundation/roadmap.md:232`). Today the poller runs locally, about 5 s per run for one user, so runs do not
  overlap. **Leave it out of Phase 1.** A test would only document a known gap, and it needs a real database to be
  meaningful.

### Risk #4 — match rule wrong at the boundaries

The rule (`src/lib/flyover.ts`):

```ts
 6  export const LEAD_MIN_S = 120;
 8  export const LEAD_MAX_S = 900;
48    if (aircraft.onGround || aircraft.trackDeg === null || aircraft.groundSpeedKt === null) {
62    const x = (aircraft.lon - home.lon) * DEG_TO_RAD * Math.cos(home.lat * DEG_TO_RAD) * EARTH_RADIUS_KM + vx * ageS;
70    if (closestDistanceKm > radiusKm || secondsToClosest > LEAD_MAX_S) {
77      alreadyClose: secondsToClosest < LEAD_MIN_S,
```

PRD sources for the oracle: radius and 2–15 min (`context/foundation/prd.md:24,111`), "<2 min still notified, marked
already close" and "on the ground ignored" (`:113,115`), outside the radius → no notification (`:61`).

Existing coverage in `src/lib/flyover.test.ts`, mapped to the four PRD cases in the guidance:

| PRD case                | Existing test                             | Oracle independent of the function?                                                                                                     |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Just outside the radius | `:93-96` (`closest - 0.001`)              | Partly. `closest` is the function's own output (`:84,94`), anchored by `toBeCloseTo(12)` from geometry (`:89`). Home is on the equator. |
| < 2 min → already close | `:116-120` (119 s) and `:110-114` (120 s) | 119 s: yes, from geometry. 120 s: the fixture is searched until the function returns exactly 120 (`:49-69`).                            |
| > 15 min → no alert     | `:106-108` (901 s) and `:100-104` (900 s) | 901 s: yes. 900 s: searched fixture (same helper).                                                                                      |
| On ground               | `:135-142`                                | Yes.                                                                                                                                    |

Verdict on the guidance:

- "Existing unit tests already cover this" is **mostly true** for the four named cases. **Two real gaps:**
  1. **Latitude.** Every distance and radius test uses `HOME = {lat: 0, lon: 0}` (`flyover.test.ts:11-12`). The only
     Warsaw test checks the compass direction, not the distance (`:163-171`). A wrong or missing `cos(home.lat)`
     (`flyover.ts:62`) would pass the whole suite. At Warsaw's latitude the factor is cos 52.23° ≈ 0.612. Dropping it
     inflates east–west distances by about 63 %, so aircraft passing east or west _inside_ the radius are missed.
     Applying it twice shrinks them by about 39 %, so aircraft _outside_ the radius get alerts. **Highest-value new case:**
     an aircraft passing due east or west at a realistic latitude, just inside and just outside the radius, with the
     expected km computed independently (haversine or a hand-worked value in a comment).
  2. **Type match.** "Matching by type" is checked in the poller (`alert-poller.ts:132`), against
     `.toUpperCase()`-normalised feed codes (`adsb.ts:118`). It has no tests. It belongs in the integration test for #1
     (a non-matching type → no send) or in a small extracted pure helper, which is a plan decision.
- The searched fixtures for exactly 120 s and 900 s guard the `<` / `>` operators against float noise. That is a
  legitimate purpose, but the boundary _value_ still comes from the function. Keep them, and anchor the PRD cases with
  geometry-derived values at a whole-number distance and speed (as `inboundFromNorth` already does).
- Not in the PRD but encoded in code: an aircraft moving away inside the radius is alerted as "already close" with
  `secondsToClosest = 0` (`flyover.ts:67`; test `flyover.test.ts:123-129`). The PRD wording ("first detected with less
  than 2 minutes to its closest approach") arguably covers this. Note it for the plan; it is not a defect.
- Query circle: radius ≤ 100 km (`src/lib/alert-settings.ts:5`) + 277.8 km look-ahead = at most 377.8 km ≈ 204 nm,
  under the 250 nm cap (`flyover.ts:33-35`, `adsb.ts:28,155-157`). No boundary is lost to the cap.

### Choosing the integration layer (stack decision left open by test-plan §4)

**Option A — Node (Vitest) with injected edges. Recommended for Phase 1.**

- ADS-B, adsbdb and Telegram: stub the global `fetch` and route by host (`opendata.adsb.fi`, `api.adsbdb.com`,
  `api.telegram.org`). This fakes only the HTTP boundaries, as test-plan §4 asks. The real parsers, clients, error
  mapping and message formatting all run.
- Supabase: `runAlertPoll` already takes the client as a parameter (`alert-poller.ts:43`). An in-memory fake has to
  support three query shapes: the `alert_settings` select with `eq`/`not`/`order` (`:52-59`), the
  `alert_notifications` select with `eq`/`gte` (`:145-149`), and the insert (`:201-210`). It must be able to inject an
  `{ error }` for each one. Keep the fake small and give it the same filter semantics. The settings-selection filters
  (paused, nulls) are already proven by the real DB elsewhere: the `alert_settings` RLS tests and the pause feature.
- Blockers to solve in the plan: (1) `astro:env/server` import of `TELEGRAM_BOT_TOKEN` (`alert-poller.ts:6`). Either
  pass the token in from `scheduled.ts`, matching how the client is already passed, or alias the module in a test-only
  Vitest config. (2) `npm test` is defined as pure `src/lib` modules only (CLAUDE.md, `vitest.config.ts:1-2,13`), so the
  poller suite needs its own config or command and a CI step (gate "poller integration", test-plan §5).
  (3) `ADSB_REQUEST_GAP_MS` is a real 1.1 s `setTimeout` between users (`alert-poller.ts:15,110-115`). Keep scenarios
  to one user, or use fake timers, for multi-user cases.
- Cost: no running services; it fits the existing CI test step.

**Option B — Node with real local Supabase.** Not recommended for Phase 1.

- Gains: real `sent_at` default, real filters and the real insert schema. These are needed later for overlapping runs or
  a run lock (parked).
- Costs: (1) Seeding `alert_settings` and `alert_notifications` and reading `cron_runs` needs a service_role client in
  test code. The CLAUDE.md hard rule names `scripts/smoke.mjs` as the **only** exception, and ESLint blocks
  `createClient` from `@supabase/supabase-js` and the `supabase-admin` import across `src/**`
  (`eslint.config.js:99-124`). This option needs a new, deliberate exception. (2) Errors cannot easily be injected into
  a single query (settings, recent alerts, insert), yet the #1 and #2 scenarios need exactly that. (3) It needs
  `supabase start`; CI only has that in the smoke job (`.github/workflows/ci.yml:28-45`).

## Code References

- `src/worker.ts:6-9` — Worker entry: `fetch` + `scheduled`
- `src/workers/scheduled.ts:33-92` — cron handler; run trace write `:55-70`; status mapping `:57-64`; log line `:85-88`
- `src/workers/alert-poller.ts:43-218` — `runAlertPoll`; ADS-B failure branches `:117-126`; type filter `:132`; dedup read `:145-154`; send/record order `:174-213`; 429/400/403 `:180-192`
- `src/lib/adsb.ts:105-152` — feed parsing (`t` → type, `alt_baro === "ground"`, skipped entries); `:169-233` fetch client
- `src/lib/alerts.ts:7,22-37` — dedup window and airframe rule; `:41-65` message text
- `src/lib/flyover.ts:6-8,43-80` — match rule constants and `predictPass`
- `src/lib/telegram.ts:27-64` — Telegram client (`httpStatus` returned for each failure)
- `src/lib/routes.ts:4,84` — adsbdb host and fetch
- `src/lib/flyover.test.ts:11-12,49-69,81-142` — existing boundary tests (home on the equator, searched fixtures)
- `src/lib/alerts.test.ts:35-60` — existing dedup unit tests
- `supabase/migrations/20261005132125_alert_notifications.sql:5-15` — dedup memory table, `sent_at default now()`
- `supabase/migrations/20260928180224_cron_runs.sql:3-13`, `20260929065324_cron_runs_hide_error.sql:6-7` — run-trace table and column grants
- `vitest.config.ts:1-15` — unit config (Node, `src/**/*.test.ts`, no Astro config)
- `eslint.config.js:99-136` — service_role import boundary

## Architecture Insights

- The edge clients (`adsb.ts`, `telegram.ts`, `routes.ts`) all follow a "never throws, returns `ok: false` with a
  readable error" contract (`adsb.ts:168`, `telegram.ts:25`). Through them the poller turns every _reported_ failure
  into a `summary.errors` string. That makes `summary.errors` a stable assertion point, and it carries no home
  coordinates or chat ID (`alert-poller.ts:3-4`). Phase 3 will care about that.
- Injection is uneven. Supabase and the clock (`now`) are parameters, `fetch` is global, and the token and admin client
  come from `astro:env/server`. The cheapest test seams follow from that: a parameter for the token, `fetch` for HTTP,
  and a fake for the client.
- `now` is injected, but `sent_at` is set by the DB and the scheduler passes the real clock (`scheduled.ts:12`).
  Window-edge tests in a two-run integration therefore have to set up `alert_notifications` rows with explicit `sent_at`
  values instead of advancing the clock.

## Historical Context (from prior changes)

- `context/archive/2026-10-05-first-advance-alert/reviews/impl-review.md:27-44` — F1 (permanent Telegram errors
  retried every minute): **supported as a finding; fixed only partially, by design.** Fix A caps attempts per run, and
  the tradeoff "one error per run" was accepted. Its "Location: alert-poller.ts:144-147" is stale; the code now sits at
  `:180-192`.
- Same file `:46-63` — F2 (no time budget; overlapping runs duplicate alerts): **supported, still open, parked** in
  `context/foundation/roadmap.md:232` as a prerequisite for deploying the poller. Its line numbers are stale; the dedup
  read is now `:145-154`.
- Same file `:22` — "`npm test` (26 passed)" at review time. The test count today is not re-verified (no tests were run
  for this research).

## Related Research

- Not applicable. No earlier `research.md` covers the poller test layer.

## Open Questions

1. **Product (user):** Should a permanent Telegram error (400/403) stop retries across runs (Fix B: disable the
   channel)? Until that is decided, Phase 1 asserts "at most one attempt per user per run", not "no attempt next
   minute".
2. **Product (user):** Should the run trace show "the feed parsed but yielded nothing usable" (`skipped` entries,
   aircraft without a type), and should `cron_runs` store counts? Without that, #1's "indistinguishable from empty sky"
   stays partly open for format drift.
3. **Plan:** How should `TELEGRAM_BOT_TOKEN` reach `runAlertPoll` in tests: as a parameter (recommended) or through a
   Vitest alias? And should there be a seam so the `cron_runs` write can be tested without mocking `@/lib/supabase-admin`?
4. **Plan:** Should the poller type filter (`alert-poller.ts:132`) be extracted into a pure helper for the #4 boundary
   table, or covered only through the integration test?
5. **Plan or PRD:** Is a `~` address without a registration that never deduplicates acceptable under FR-010? It is
   speculative until someone sees a typed TIS-B target in the feed.
