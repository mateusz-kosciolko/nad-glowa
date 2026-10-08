<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Trasa w alercie (S-07)

- **Plan**: context/changes/route-in-alerts/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Sequential route lookups can stack up during an alert burst when adsbdb is down

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/workers/alert-poller.ts:164
- **Detail**: Lookups are awaited one by one inside the candidate send loop; each unique callsign can cost up to 2 s when adsbdb hangs. Steady state is 0–3 alerts per run (60 min dedup), but a user's first run after enabling, unpausing or changing types can yield 10–30 candidates → +20–60 s. Later sends get late (the "Overhead in ~N min" text is computed from `at`), and a run longer than 60 s makes overlap with the next cron run (double send before the insert) more likely. The plan's Performance Considerations accepted "+2 s per alert" but did not consider the burst case.
- **Fix A ⭐ Recommended**: Start all of a user's lookups in parallel before the send loop (`candidates.map(c => routeFor(c.aircraft))`), await each promise when sending
  - Strength: Bounds a user's burst to ~2 s; the per-run Promise cache already supports it; no change to routes.ts.
  - Tradeoff: Fires lookups also for candidates that end up not sent (Telegram 400/403/429 break) — a few wasted requests to adsbdb.
  - Confidence: HIGH — small local change, behaviour otherwise identical.
  - Blind spot: adsbdb's unpublished rate limit under ~30 parallel requests.
- **Fix B**: Run-level breaker — after the first timeout/network error, return null for the rest of the run
  - Strength: Zero extra requests while adsbdb is down; bounds the whole run to one 2 s timeout.
  - Tradeoff: `lookupRoute` must distinguish a miss from a failure (change its return type and tests).
  - Confidence: MED — wider change across both phases.
  - Blind spot: A single transient timeout drops routes for the remainder of the run.
- **Decision**: FIXED (Fix A)

### F2 — adsbdb text and callsign used without normalisation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/routes.ts:26-44, src/lib/routes.ts:66
- **Detail**: `municipality`/codes are only trimmed: an embedded newline or a huge value would add fake lines or push past Telegram's 4096-char limit (400 → that user's remaining candidates skipped, repeating every run). Separately, a callsign of `.`/`..` is not encoded by `encodeURIComponent` and resolves to another path on the same host (harmless: fixed host, no credentials, non-200 → null). Unlikely with real adsbdb data.
- **Fix**: Collapse internal whitespace and cap city (~60) and code (~4) lengths in `readString`/`parseAirport`; skip lookup for callsigns not matching `/^[A-Z0-9]{2,8}$/i`.
- **Decision**: FIXED

### F3 — Test does not assert the User-Agent header

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/routes.test.ts:121-130
- **Detail**: The URL/signal test does not check the `User-Agent` that identifies the app to adsbdb (shared contract with adsb.ts).
- **Fix**: Add `expect(new Headers(init?.headers).get("User-Agent")).toContain("nad-glowa")`.
- **Decision**: FIXED
