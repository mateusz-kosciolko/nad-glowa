# Test rollout Phase 1 — Poller critical path Implementation Plan

## Overview

Ship the first two test layers for the alert poller, as asked by rollout Phase 1 of
`context/foundation/test-plan.md` (risks #1, #2, #4):

- **Unit (boundary table):** match-rule boundaries at Warsaw's latitude, with expectations derived from spherical geometry
  and PRD values, plus a pure run-trace mapping (`summary.errors` → `cron_runs` status).
- **Integration (fake external edges):** `runAlertPoll` driven in Node with the global `fetch` stubbed by host
  (ADS-B, adsbdb, Telegram) and an in-memory fake of the Supabase client, in its own Vitest config and command.

Two small production seams make this possible without touching the service_role boundary: the Telegram token becomes a
parameter of `runAlertPoll`, and the trace mapping moves out of `handleScheduled` into a pure function.

## Current State Analysis

- `runAlertPoll(supabase, now)` already takes the Supabase client and the clock as parameters
  (`src/workers/alert-poller.ts:43`), but reads `TELEGRAM_BOT_TOKEN` from `astro:env/server` (`:6,46`), which Node
  Vitest cannot resolve.
- The three HTTP edges all use the global `fetch` with fixed hosts: `opendata.adsb.fi` (`src/lib/adsb.ts:17,186`),
  `api.adsbdb.com` (`src/lib/routes.ts:4,84`), `api.telegram.org` (`src/lib/telegram.ts:4,36`). All three clients
  never throw and report failures as `ok: false` / `null`.
- The run trace: `handleScheduled` maps `summary.errors` (joined, cut to 500 characters) or a thrown exception to
  `status='error'` (`src/workers/scheduled.ts:55-64`) and writes one `cron_runs` row. It builds its own client via
  `createAdminClient()` (`:40`), so the mapping cannot be tested without mocking the service_role module.
- Dedup memory across runs is the `alert_notifications` table, read with `.eq("user_id")` + `.gte("sent_at", now − 60 min)`
  (`alert-poller.ts:145-149`) and written **after** a successful send (`:174-213`); `sent_at` is the DB default `now()`
  (`supabase/migrations/20261005132125_alert_notifications.sql:11`).
- `vitest.config.ts:12` includes `src/**/*.test.ts`, so a test under `src/workers/` would land in `npm test`, whose
  contract (CLAUDE.md) is pure `src/lib` modules only.
- Existing unit coverage: `src/lib/flyover.test.ts` puts every distance test at `HOME = {lat: 0, lon: 0}`
  (`:11-12`), where `cos(lat) = 1`; the 120 s / 900 s fixtures are searched with `predictPass` itself (`:49-69`).
  `src/lib/alerts.test.ts:35-60` covers the pure dedup function. Nothing covers `alert-poller.ts`, `scheduled.ts`,
  the type filter (`alert-poller.ts:132`) or feed parsing.

## Desired End State

- `npm test` runs only `src/lib/**/*.test.ts` and additionally contains a Warsaw boundary table for `predictPass` and a
  table for the run-trace mapping.
- `npm run test:integration` runs `src/workers/**/*.integration.test.ts` and proves, through real parsers, clients and
  message formatting:
  - #1: one matching aircraft → exactly one Telegram request with the expected `chat_id` and text; type matching
    (case-normalised match, non-selected type, missing type); every reported failure lands in `summary.errors` and maps
    to `status='error'`.
  - #2: a second run on the same airframe (other callsign; same hex or same registration) sends nothing; 59 min old
    row blocks, 61 min does not; dedup is per user; 400/403 → one attempt per user per run; 429 → nothing more in the
    run and the error names the skipped users.
- CI runs `npm run test:integration` in the `ci` job; CLAUDE.md documents the command.
- `context/foundation/test-plan.md` §6.1, §6.2, §6.6 hold the shipped patterns; §4 rows and §5 gate reflect what is
  wired; `context/foundation/roadmap.md` `## Parked` records the "feed parses but nothing matches" product gap.

Verify with `npm run lint`, `npx astro sync && npx astro check`, `npm test`, `npm run test:integration`, `npm run build`.

### Key Discoveries:

- `runAlertPoll` already follows a "pass the edge in" pattern for Supabase and the clock; the token is the only
  outlier (`src/workers/alert-poller.ts:6,43,46`).
- `src/lib/cron-runs.ts` is shared and has "no server-only imports" (`:1`) — the right home for a pure trace mapping.
- The ESLint service_role boundary (`eslint.config.js:99-124`) only restricts `SUPABASE_SERVICE_KEY` from
  `astro:env/server`; importing `TELEGRAM_BOT_TOKEN` in `scheduled.ts` stays legal.
- `ADSB_REQUEST_GAP_MS` is a real 1.1 s wait between users (`alert-poller.ts:15,110-115`); multi-user scenarios cost
  ~1.1 s each.
- Telegram's success contract is HTTP 2xx **and** body `{ ok: true }` (`src/lib/telegram.ts:57`); a fake returning a
  bare 200 would read as a failure.
- On 2026-10-10 Warsaw is on CEST (UTC+2), so a `now` of `12:00Z` renders as `14:00` local (`src/lib/alerts.ts:10-18`).

## What We're NOT Doing

- **No local Supabase in this phase.** It would need a new service_role exception in test code and gives no extra
  signal for the in-scope scenarios (research, "Choosing the integration layer").
- **No assertion against the next-run retry after 400/403.** Retrying on the next run is accepted behaviour
  (archive `first-advance-alert` impl-review F1, Fix A). Stopping retries for good (Fix B) is a product decision.
- **"Feed parses but nothing matches" stays a documented product gap**, not a test: entries without `lat`/`lon`
  (counted in `skipped`) or without `t` leave the run `ok`. No test pretends to prove visibility. Recorded in §6.6 and
  as a roadmap `## Parked` entry.
- **By-design dedup gaps are documented, not tested:** overlapping runs (parked until the poller is deployed), a `~`
  (TIS-B) address without a registration, and "sent but not recorded" (repeat next run). The insert-failure case is
  asserted only for its visible trace error, not for what happens next run.
- **No edge-latency/timeout scenarios** (route lookup timeout, slow ADS-B, per-user isolation of slow sends): rollout
  Phase 2 (risk #3) owns them. This phase uses only immediate fake responses.
- **No test of the `cron_runs` insert or retention prune** in `handleScheduled`; only the pure mapping is tested.
- **No changes to `predictPass`, dedup or matching logic.** If a new test fails on real behaviour, stop and report it;
  do not adjust the expectation to the output.
- No e2e, no MCP, no hooks, no new CI job (one `run:` line in the existing `ci` job only).

## Implementation Approach

Order by cost × signal and risk priority: first the seams (no behaviour change), then the cheapest unit tables (#4 and
the trace mapping for #1), then the integration harness with #1 scenarios, then #2 scenarios on the same harness, and
finally the cookbook. Every test asserts on observable output — captured HTTP request bodies, the fake's stored rows,
the returned summary — never on "function X was called".

**Oracle rules for every test in this plan:**

- Expected values come from geometry computed independently (spherical haversine, distance = speed × time), from the
  PRD (radius, 2–15 min, "already close", on ground, same airframe = hex or registration), or from the test plan's
  60-minute window. Never from running the function under test and copying its output, and never by searching for a
  fixture with the function.
- Use clear margins around boundaries (e.g. 9.8 / 10.2 km for a 10 km radius, 1 min / 14 min / 16 min lead) — the exact
  float edges stay covered by the existing tests.

## Critical Implementation Details

- **Fake fidelity, not fake intelligence.** The Supabase fake implements generic filter semantics (`eq`, `not … is null`,
  `gte` on ISO strings, `order`) over stored rows, and fills `sent_at` on insert with the injected clock time (the DB
  default `now()`). It must not know what the poller "expects"; otherwise the dedup tests mirror the implementation.
- **Fail loudly on unknown edges.** The `fetch` stub throws (or fails the test) for any host other than the three
  known ones, so a new hidden dependency cannot be silently served.
- **Telegram fake responses** must use the real API shape: success `200 {"ok":true,"result":{}}`; failure
  `<status> {"ok":false,"description":"…"}`.

## Phase 1: Seams and integration command

### Overview

Make the poller and the trace mapping testable without `astro:*` or service_role, and add the integration Vitest config
and script. No behaviour change.

### Changes Required:

#### 1. Token as a parameter

**File**: `src/workers/alert-poller.ts`

**Intent**: Remove the `astro:env/server` import; receive the token from the caller, the same way the client and clock
are already injected. Keep the existing "not configured" error for an empty/undefined token.

**Contract**: `runAlertPoll(supabase: SupabaseClient<Database>, now: () => Date, token: string | undefined): Promise<AlertPollSummary>`.
Update the header comment (it lists what the module never imports/carries).

**File**: `src/workers/scheduled.ts`

**Intent**: Import `TELEGRAM_BOT_TOKEN` from `astro:env/server` and pass it in `runWork`.

**Contract**: `runAlertPoll(supabase, () => new Date(), TELEGRAM_BOT_TOKEN)`.

#### 2. Pure run-trace mapping

**File**: `src/lib/cron-runs.ts`

**Intent**: Move the "summary errors or thrown exception → status + bounded error text" rule out of `handleScheduled`
so it can be unit-tested; `handleScheduled` keeps its behaviour by calling it.

**Contract**: an exported `MAX_RUN_ERROR_CHARS = 500` and a function such as
`describeRunOutcome(outcome: { errors: readonly string[] } | { thrown: unknown }): { status: CronRunStatus; error: string | null }`
— errors non-empty → `error`, joined with `"; "` and cut to 500 chars; thrown → `error` with the `Error.message` (or
`String(value)`); empty errors → `ok`, `null`. Takes the errors structurally so `src/lib` does not import from
`src/workers`.

**File**: `src/workers/scheduled.ts`

**Intent**: Replace the inline mapping (`:52-64`) and the local `MAX_ERROR_CHARS` with the new function; logging and
the insert stay unchanged.

#### 3. Separate integration config and command

**File**: `vitest.config.ts`

**Intent**: Narrow the unit run to what CLAUDE.md promises.

**Contract**: `include: ["src/lib/**/*.test.ts"]`.

**File**: `vitest.integration.config.ts` (new)

**Intent**: Node config for poller integration tests, same `@` alias, no Astro config.

**Contract**: `include: ["src/workers/**/*.integration.test.ts"]`, `environment: "node"`; header comment explaining
that edges are faked (fetch by host, Supabase in memory) and no `astro:*` module may be imported.

**File**: `package.json`

**Contract**: script `"test:integration": "vitest run --config vitest.integration.config.ts"`. (The CI line and the
CLAUDE.md entry land in Phase 3, when the first test file exists — `vitest run` fails on zero files, and that failure
must stay meaningful.)

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro sync && npx astro check` passes
- `npm test` passes with the same test count as before the change
- `npm run build` passes
- `grep -n "astro:env" src/workers/alert-poller.ts` returns nothing

#### Manual Verification:

- With `npm run dev` and `npm run cron:local` running, one run is recorded in `cron_runs` with the same status as
  before the change (alerts still send when a token is configured)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation before proceeding.

---

## Phase 2: Unit tables — run trace (#1) and match boundaries at Warsaw (#4)

### Overview

The cheapest signal first: pure tables with independent oracles.

### Changes Required:

#### 1. Run-trace mapping table

**File**: `src/lib/cron-runs.test.ts` (new, or extend if present)

**Intent**: Prove that anything reported as an error cannot end as an `ok` run.

- **Behaviour asserted:** `{errors: []}` → `ok`/`null`; one error → `error` with that text; two errors → joined with
  `"; "`; 600-character joined text → exactly 500 characters; `{thrown: new Error("boom")}` → `error`/`"boom"`;
  `{thrown: "x"}` → `error`/`"x"`.
- **Regression caught:** errors dropped or the status left `ok` when errors exist ("run without an exception = good
  run", the must-challenge of #1); an unbounded error text breaking the trace write.
- **Research source:** research "Run path and the run trace" (`scheduled.ts:57-64`); `cron_runs.sql:12` ties `error`
  to `status='error'`.
- **Edge/boundary:** empty array, the 500-character cut.
- **Anti-pattern avoided:** asserting only that a mapping function was called; the table asserts values.

#### 2. Warsaw boundary table for `predictPass`

**File**: `src/lib/flyover.test.ts` (new `describe` block; existing tests untouched)

**Intent**: Pin the PRD match rule at a realistic latitude, where a missing or doubled `cos(lat)` changes the outcome.

**Contract (fixture geometry, all independent of `predictPass`):**

- Home Warsaw `{lat: 52.23, lon: 21.01}`, radius 10 km, speed 360 kt (= 0.1852 km/s).
- **East/west passes:** aircraft due south of home at `300 s × 0.1852 km/s = 55.56 km`, flying north (track 0), offset
  east or west by `X` km. The closest point lies on home's parallel, so the expected closest distance is `X`. The
  longitude offset is obtained by inverting haversine on that parallel:
  `Δlon = 2·asin(sin(X / (2R)) / cos(lat))` with R = 6371 km — not the flat-frame formula the function uses. Comment the
  derivation in the test.
- **Lead time:** aircraft due north, flying south over home, at `t × 0.1852 km` (latitude offset only, no `cos`).

| Case                             | Input                        | Expected (oracle)                                                                          |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| East pass, just inside           | X = 9.8 km                   | alert, `closestDistanceKm ≈ 9.8` (±0.05), `secondsToClosest ≈ 300` (±1), not already close |
| East pass, just outside          | X = 10.2 km                  | no alert (PRD: outside radius → no notification)                                           |
| West pass, just inside / outside | X = 9.8 / 10.2 km, track 0   | alert / no alert                                                                           |
| Lead < 2 min                     | t = 60 s                     | alert, `alreadyClose: true` (PRD "<2 min still notified, marked already close")            |
| Lead inside horizon              | t = 14 min                   | alert, `alreadyClose: false`                                                               |
| Lead beyond horizon              | t = 16 min                   | no alert (PRD 2–15 min)                                                                    |
| On ground                        | t = 10 min, `onGround: true` | no alert (PRD: on the ground ignored)                                                      |

- **Behaviour asserted:** the PRD decision (alert / no alert / already close) per row, plus distance and time where the
  geometry gives a value.
- **Regression caught:** dropped `cos(home.lat)` (9.8 km becomes ~16 km → missed pass); doubled `cos` (10.2 km becomes
  ~6.2 km → false alert); swapped or wrong lead-time constants; ignoring `onGround`.
- **Research source:** research "Risk #4" (latitude gap, `flyover.ts:62`; searched fixtures `flyover.test.ts:49-69`).
- **Edge/boundary:** ±2 % around the radius on both sides of home; minute-level lead-time values around 2 and 15 min.
- **Anti-pattern avoided:** expectations read from the function's output or fixtures searched with the function; home
  on the equator.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including the new `cron-runs` and Warsaw boundary tests
- `npm run lint` passes
- Mutation check (local, not committed): removing `Math.cos(home.lat * DEG_TO_RAD)` from `src/lib/flyover.ts:62` makes
  at least one Warsaw east/west case fail; restoring it makes the suite green

#### Manual Verification:

- The haversine derivation comment and every expected value in the table can be traced to geometry or a PRD line, not
  to a function result

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation before proceeding.

---

## Phase 3: Integration harness and risk #1 scenarios

### Overview

Build the fakes once, then prove "one matching aircraft → exactly one alert" and "reported failure → visible in the
trace". Wire the command into CI and CLAUDE.md.

### Changes Required:

#### 1. Edge fakes

**File**: `src/workers/poller-fakes.ts` (new; imported only by integration tests)

**Intent**: Fake only the external boundaries so the real parser, clients, prediction, dedup and formatting run.

**Contract:**

- **Feed/HTTP fake:** installs a `fetch` stub (`vi.stubGlobal`, restored after each test) that routes by URL host:
  `opendata.adsb.fi` → a configurable response (default `200` with `{ ac: [...] }` in the raw feed format:
  `hex, t, r, flight, lat, lon, track, gs, alt_baro, seen_pos`); `api.adsbdb.com` → default `404` (route unknown);
  `api.telegram.org` → a configurable queue of responses, default `200 {"ok":true,"result":{}}`. Any other host fails
  the test. Records every request (host, path, parsed JSON body) for assertions. A builder for a raw feed entry with
  sensible defaults (fresh position, airborne).
- **Supabase fake:** an object typed as `SupabaseClient<Database>` (cast once, in this file) holding `alert_settings`
  and `alert_notifications` rows; supports exactly the query shapes the poller uses
  (`select().eq().not().not().not().order()`, `select().eq().gte()`, `insert()`) as awaitable builders with generic
  filter semantics; `insert` stores the row with `sent_at` = the injected clock; per-operation error injection
  (`settingsError`, `recentError`, `insertError`).
- **Fixture constants:** `NOW = 2026-10-10T12:00:00Z` (14:00 Warsaw, CEST); one default user at Warsaw, radius 10,
  types `["B738"]`, chat ID a fixed number; token a fixed fake string.

#### 2. Risk #1 scenarios

**File**: `src/workers/alert-poller.integration.test.ts` (new)

Aircraft geometry for every "matching" fixture: due north of home at `600 s × 0.1852 km/s = 111.12 km`, track 180,
gs 360, `seen_pos` 0 → expected "~10 min", clock `(14:10)`, "Approaching from N", closest `0.0 km`.

- **Exactly one alert.** Feed: one B738 (`hex 48af01`, `r SP-LWA`) matching, plus one A320 on the same track (not
  selected).
  - Behaviour asserted: exactly one Telegram request; its body `chat_id` equals the user's; its `text` contains
    `B738 · SP-LWA`, `~10 min (14:10)`, `Approaching from N`, `Route unknown`, `globe.adsb.fi/?icao=48af01`;
    `summary.sent === 1`, `summary.errors` empty; one `alert_notifications` row with the user's id, `48af01`,
    `SP-LWA`, `already_close: false`; `describeRunOutcome(summary).status === "ok"`.
  - Regression caught: no alert for a matching pass; duplicate send; wrong chat; wrong or missing message fields; send
    without recording.
  - Research source: research "Risk #1" happy path (`alert-poller.ts:131-179`), oracle note (N from geometry).
  - Edge: the non-selected aircraft on the same track proves the filter is not "send everything".
  - Anti-pattern avoided: "send function was called"; N copied from `formatAlertMessage`.
- **Type matching** (`it.each`): feed `t: "b738"` vs user `B738` → one send (parser normalisation meets filter);
  user types `["A320"]`, feed B738 → no Telegram request, `summary.matches === 0`; feed entry without `t` → no Telegram
  request, `errors` empty (correct for one aircraft; the fleet-wide blind spot is the documented gap).
  - Regression caught: case mismatch between parser and filter; filter dropped or inverted.
  - Research source: research "Risk #4" gap 2 (`alert-poller.ts:132`, `adsb.ts:118`).
- **Reported failures → trace** (`it.each`, each asserts a `summary.errors` entry containing the stated fragment **and**
  `describeRunOutcome(summary).status === "error"`, plus the send count):
  | Injected failure                      | Error fragment                            | Sends                            |
  | ------------------------------------- | ----------------------------------------- | -------------------------------- |
  | token `undefined`                     | `TELEGRAM_BOT_TOKEN is not configured`    | 0, and no HTTP request at all    |
  | `settingsError`                       | `reading alert settings failed`           | 0                                |
  | ADS-B `503`                           | `HTTP 503`                                | 0                                |
  | ADS-B body not JSON                   | `not valid JSON`                          | 0                                |
  | ADS-B `200 {}` (no `ac`)              | `without an "ac" array`                   | 0                                |
  | ADS-B `429`, two users                | `polling stopped for the remaining users` | 0, and exactly one ADS-B request |
  | `recentError`                         | `reading recent alerts failed`            | 0 (no send without dedup memory) |
  | Telegram `500`                        | `Telegram send failed`                    | 1 attempt, no notification row   |
  | `insertError` after a successful send | `alert sent but not recorded`             | 1                                |
  - Regression caught: a reported failure that leaves the run looking like empty sky (`ok`).
  - Research source: research "Risk #1" table of failures that reach the trace.
  - Anti-pattern avoided: asserting "no exception thrown".

#### 3. Wire the gate

**File**: `.github/workflows/ci.yml`

**Contract**: one step `- run: npm run test:integration` in the `ci` job, right after `npm test`.

**File**: `CLAUDE.md` (outside the 10x-cli BEGIN/END block)

**Intent**: Document `npm run test:integration` under Commands (what it runs, that edges are faked, no `astro:*`
imports in tested modules) and update the "kinds of automated tests" sentence; narrow the `npm test` line to
`src/lib/**/*.test.ts` if it is not already that precise.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes with the #1 scenarios
- `npm test` passes and does not pick up `*.integration.test.ts`
- `npm run lint` passes
- `npx astro sync && npx astro check` passes
- Mutation check (local, not committed): changing `alert-poller.ts:132` to skip the type check makes the A320 / A320-user
  cases fail; deleting the `summary.errors.push` in the Telegram failure branch makes the Telegram `500` case fail

#### Manual Verification:

- Reading a failing assertion message makes it clear which edge failed and what was expected (no opaque snapshot diffs)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation before proceeding.

---

## Phase 4: Integration — risk #2 scenarios

### Overview

Reuse the harness to prove "no repeat within the window" across runs and the per-run limits on failed sends.

### Changes Required:

#### 1. Risk #2 scenarios

**File**: `src/workers/alert-poller.integration.test.ts`

- **Two runs, same airframe** (`it.each`): run 1 sends for `hex 48af01, r SP-LWA, flight LOT3`; run 2 with the clock
  one minute later on the **same fake database** and a feed with (a) same hex, callsign `LOT9`; (b) hex `48af99`,
  same registration. Expected: run 2 makes no Telegram request, `summary.duplicates === 1`. Control row (c) hex
  `48af99`, registration `SP-LWB` → run 2 sends one.
  - Regression caught: insert payload losing `aircraft_hex` or `registration`; the read filter on `user_id` or
    `sent_at` broken; record-before-send order changed; dedup keyed on callsign.
  - Research source: research "Risk #2" verdict ("needs an integration test because the dedup memory is a DB row
    written after the send").
  - Edge: the control row proves the test does not pass because run 2 blocks everything.
  - Anti-pattern avoided: relying on the pure `isRecentlyAlerted` test as proof of the cross-run guarantee.
- **Window from FR-010 / test plan (60 min)** (`it.each`): seed one `alert_notifications` row for the same hex with
  `sent_at = NOW − 59 min` → no send; `NOW − 61 min` → one send.
  - Regression caught: window shortened, lengthened, or the read filter widened/narrowed.
  - Research source: research "Risk #2" (oracle from FR-010, minute-level, not the `>=` edge in `alerts.ts:29`).
  - Anti-pattern avoided: boundary copied from the implementation's `>=` check (the exact 60-min edge stays covered by
    `alerts.test.ts`).
- **Dedup is per user:** two users at the same home, same aircraft; user A has a 10-min-old row → only user B's chat
  receives one message.
  - Regression caught: dropping `.eq("user_id", …)` (one user's alert silencing others).
  - Research source: research "Risk #2" (`alert-poller.ts:148`; FR-010 "User does not receive…").
- **400 / 403 cap** (`it.each` over 400 `chat not found`, 403 `bot was blocked by the user`): one user, two matching
  candidates (different hex and registration), Telegram answers the status → exactly one Telegram request, one error
  containing the description, no notification rows. Contrast row: Telegram `500` on both → two requests (the cap is
  specific to permanent errors).
  - Regression caught: a permanent error retried for every candidate in the same run.
  - Research source: research "Risk #2" (`alert-poller.ts:187-190`; archive impl-review F1 Fix A).
  - Anti-pattern avoided: asserting no attempt in the next run — that retry is accepted behaviour.
- **429 stops the run:** two users, one candidate each; Telegram answers `429` for the first → exactly one Telegram
  request and one ADS-B request in total; errors contain `Telegram rate limit hit; 1 user(s) skipped in this run`.
  - Regression caught: sending to remaining users after a rate limit; skipped users invisible in the trace.
  - Research source: research "Risk #2" (`alert-poller.ts:103-105,183-186`).

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes with the #1 and #2 scenarios, in under 15 s locally
- `npm run lint` passes
- `npx astro sync && npx astro check` passes
- Mutation check (local, not committed): removing `registration: aircraft.registration` from the insert payload
  (`alert-poller.ts:204`) makes case (b) fail; removing `.eq("user_id", user.userId)` makes the per-user case fail;
  removing the 400/403 `break` makes the cap cases fail

#### Manual Verification:

- No test asserts behaviour in the run after a 400/403, an insert failure or an overlapping run (the accepted gaps)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation before proceeding.

---

## Phase 5: Cookbook and documentation

### Overview

Turn what shipped into the canonical "how to add a test for X" answers and record the product gap.

### Changes Required:

#### 1. Test-plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the Phase 1 placeholders with the shipped patterns; leave §1–§3 and §7 untouched (the orchestrator
owns §3 status).

**Contract:**

- **§6.1 Adding a unit test:** location `src/lib/<module>.test.ts`, explicit `vitest` imports, run `npm test`; the
  boundary-table pattern (realistic latitude, oracle from geometry/PRD with the derivation in a comment, margins around
  boundaries, never search fixtures with the function); reference test: the Warsaw block in `src/lib/flyover.test.ts`
  and `src/lib/cron-runs.test.ts`.
- **§6.2 Adding a poller integration test:** location `src/workers/*.integration.test.ts`, fakes in
  `src/workers/poller-fakes.ts`, run `npm run test:integration`; rules: fake only HTTP hosts and the Supabase client,
  unknown hosts fail, assert on captured request bodies / stored rows / summary, pass the token as a parameter, keep
  ≤ 2 users per scenario (1.1 s gap); reference tests: "exactly one alert" and "two runs, same airframe".
- **§6.6 Phase 1 notes:** known gaps not covered by tests — "feed parses but nothing matches" (status `ok`; roadmap
  Parked), next-run retry after 400/403 (accepted, Fix A), TIS-B `~` without registration, sent-but-not-recorded,
  overlapping runs (parked); the integration layer decision (Node with fake edges, local Supabase not used).
- **§4 Stack:** rows "integration (poller)" → Vitest ^5.0.3 via `vitest.integration.config.ts`; "API mocking" →
  `fetch` stubbed by host + in-memory Supabase fake (`src/workers/poller-fakes.ts`).
- **§5 Quality Gates:** "poller integration" → `required (wired)`.
- Header `Last updated:` set to the implementation date; §8 Freshness Ledger left as is (strategy was not reviewed).

#### 2. Roadmap parked entry

**File**: `context/foundation/roadmap.md`

**Intent**: Make the #1 product gap visible where product decisions live.

**Contract**: one bullet in `## Parked`, e.g. **"Widoczność dryfu formatu ADS-B w śladzie biegu"** — Why parked: a feed
that parses but yields no usable aircraft (entries skipped, missing type) leaves the run `ok`; surfacing `skipped` or a
"no typed aircraft" warning needs a threshold the PRD does not define (test-plan rollout Phase 1, risk #1). Update the
frontmatter `updated:`.

### Success Criteria:

#### Automated Verification:

- `grep -c "TBD — see §3 Phase 1" context/foundation/test-plan.md` returns 0
- `npx prettier --check context/foundation/test-plan.md context/foundation/roadmap.md` passes

#### Manual Verification:

- A reader of §6.1 / §6.2 alone can add a new boundary case or poller scenario without opening this plan
- The roadmap Parked entry states the gap in user terms and names its source

---

## Testing Strategy

### Unit Tests:

- `src/lib/cron-runs.test.ts`: trace mapping table (ok, one/two errors, 500-char cut, thrown Error / non-Error).
- `src/lib/flyover.test.ts`: Warsaw boundary table (east/west ±2 % of radius, 1 / 14 / 16 min, on ground).

### Integration Tests:

- `src/workers/alert-poller.integration.test.ts`: exactly one alert; type matching; reported failures → `error`;
  two runs same airframe (hex / registration / control); 59 / 61 min window; per-user dedup; 400/403 cap with 500
  contrast; 429 stop.

### Manual Testing Steps:

1. After Phase 1, run `npm run dev` + `npm run cron:local`, confirm a `cron_runs` row with the expected status.
2. For each mutation check listed in Phases 2–4, apply the mutation locally, confirm the named test fails, revert.
3. Read §6.1 / §6.2 as a newcomer and confirm they are self-sufficient.

## Performance Considerations

Integration scenarios with two users wait the real `ADSB_REQUEST_GAP_MS` (~1.1 s); there are about four such cases, so
the suite stays well under 15 s. Fake timers are deliberately not used, to keep the fetch/timer interplay simple.

## Migration Notes

None. The only production changes are the `runAlertPoll` signature (one caller) and moving the trace mapping; both are
behaviour-preserving and verified by Phase 1.

## References

- Change: `context/changes/testing-poller-critical-path/change.md`
- Research: `context/changes/testing-poller-critical-path/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (risks #1, #2, #4 and response guidance), §3 Phase 1, §5, §6
- PRD: `context/foundation/prd.md:24,47,61,93,111-115`
- Archive: `context/archive/2026-10-05-first-advance-alert/reviews/impl-review.md` (F1 Fix A, F2)
- Code: `src/workers/alert-poller.ts:43-218`, `src/workers/scheduled.ts:33-92`, `src/lib/flyover.ts:43-80`,
  `src/lib/alerts.ts:20-65`, `src/lib/adsb.ts:105-152`, `src/lib/telegram.ts:27-64`, `vitest.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seams and integration command

#### Automated

- [x] 1.1 `npm run lint` passes — 2d87734
- [x] 1.2 `npx astro sync && npx astro check` passes — 2d87734
- [x] 1.3 `npm test` passes with the same test count as before the change — 2d87734
- [x] 1.4 `npm run build` passes — 2d87734
- [x] 1.5 `grep -n "astro:env" src/workers/alert-poller.ts` returns nothing — 2d87734

#### Manual

- [x] 1.6 One `cron:local` run is recorded in `cron_runs` with the same status as before the change — 2d87734

### Phase 2: Unit tables — run trace (#1) and match boundaries at Warsaw (#4)

#### Automated

- [x] 2.1 `npm test` passes, including the new `cron-runs` and Warsaw boundary tests
- [x] 2.2 `npm run lint` passes
- [x] 2.3 Mutation check: removing the `cos(home.lat)` factor fails at least one Warsaw east/west case

#### Manual

- [x] 2.4 Every expected value in the boundary table traces to geometry or a PRD line

### Phase 3: Integration harness and risk #1 scenarios

#### Automated

- [ ] 3.1 `npm run test:integration` passes with the #1 scenarios
- [ ] 3.2 `npm test` passes and does not pick up `*.integration.test.ts`
- [ ] 3.3 `npm run lint` passes
- [ ] 3.4 `npx astro sync && npx astro check` passes
- [ ] 3.5 Mutation check: skipping the type filter and dropping the Telegram failure error each fail a named case

#### Manual

- [ ] 3.6 Failing assertion messages name the failed edge and the expectation

### Phase 4: Integration — risk #2 scenarios

#### Automated

- [ ] 4.1 `npm run test:integration` passes with the #1 and #2 scenarios, in under 15 s locally
- [ ] 4.2 `npm run lint` passes
- [ ] 4.3 `npx astro sync && npx astro check` passes
- [ ] 4.4 Mutation check: insert registration, `user_id` filter and 400/403 `break` each fail a named case

#### Manual

- [ ] 4.5 No test asserts behaviour after a 400/403, an insert failure or an overlapping run

### Phase 5: Cookbook and documentation

#### Automated

- [ ] 5.1 No `TBD — see §3 Phase 1` placeholder remains in the test plan
- [ ] 5.2 Prettier check passes for the test plan and roadmap

#### Manual

- [ ] 5.3 §6.1 / §6.2 are self-sufficient for adding a new case
- [ ] 5.4 The roadmap Parked entry states the gap in user terms and names its source
