# Test rollout Phase 1 — Poller critical path — Plan Brief

> Full plan: `context/changes/testing-poller-critical-path/plan.md`
> Research: `context/changes/testing-poller-critical-path/research.md`

## What & Why

The poller is the product: a matching aircraft must produce exactly one Telegram alert, never a repeat within the
60-minute window, and the 2–15 min / radius rule must hold at the boundaries. Today none of that is tested beyond pure
helpers, and the existing boundary tests sit on the equator, where a latitude bug is invisible. This plan adds the
cheapest tests that cover risks #1, #2 and #4 from `context/foundation/test-plan.md`.

## Starting Point

`runAlertPoll` already takes Supabase and the clock as parameters; HTTP edges go through the global `fetch`. The
token comes from `astro:env/server`, and the `cron_runs` status mapping is buried in `handleScheduled` behind the
service_role client. Unit tests exist only for `src/lib`.

## Desired End State

`npm test` holds a Warsaw boundary table and a run-trace mapping table. A new `npm run test:integration` (in CI) runs
the real poller against fake HTTP hosts and an in-memory Supabase and proves: one alert with the right chat and text,
type matching, reported failures → `status='error'`, no repeat across runs (hex or registration), the 59/61 min
window, per-user dedup, and the 400/403 and 429 per-run limits. The test plan's §6 cookbook explains how to add more.

## Key Decisions Made

| Decision                       | Choice                                                                             | Why (1 sentence)                                                    | Source          |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------- |
| Integration environment        | Node + fake edges, no local Supabase                                               | Same signal for in-scope cases without a new service_role exception | Research        |
| Token in tests                 | Third parameter of `runAlertPoll`                                                  | Matches existing injection; poller drops its only `astro:*` import  | Plan            |
| Trace mapping                  | Pure function in `src/lib/cron-runs.ts`, unit-tested                               | Cheapest signal, no mock of `supabase-admin`                        | Plan            |
| Type matching                  | Covered in integration through the raw feed                                        | Also catches parser ↔ filter case normalisation                     | Plan            |
| Command                        | Separate `vitest.integration.config.ts` + `npm run test:integration` + one CI line | Keeps `npm test` pure; gives the §5 gate its own step               | Plan            |
| "Feed parses, nothing matches" | Documented gap + roadmap Parked entry, no test                                     | Today the trace says `ok`; a test would only pretend                | Plan / Research |
| 400/403 next-run retry         | Not asserted against                                                               | Accepted behaviour (impl-review F1, Fix A)                          | Research        |
| Window oracle                  | 59 min blocks, 61 min does not                                                     | From FR-010 / test plan, not the code's `>=`                        | Research        |

## Scope

**In scope:** token seam; pure trace mapping; integration config/command/CI/CLAUDE.md; Warsaw boundary table;
integration scenarios for #1 and #2; §6 cookbook, §4/§5 rows, roadmap Parked entry.

**Out of scope:** local Supabase; overlapping runs; TIS-B without registration; sent-but-not-recorded follow-up;
next-run retry after 400/403; timeouts and slow edges (rollout Phase 2); any change to matching or dedup logic.

## Architecture / Approach

```
test ──► runAlertPoll(fakeSupabase, () => NOW, "token")
            │  real parser, predictPass, isRecentlyAlerted, formatAlertMessage, clients
            ▼
         global fetch stub ── opendata.adsb.fi (raw feed JSON)
                           ── api.adsbdb.com   (404 = route unknown)
                           ── api.telegram.org (captured bodies, queued statuses)
                           ── anything else    → test fails
assert on: captured Telegram bodies · fake rows · summary · describeRunOutcome(summary)
```

## Phases at a Glance

| Phase                | What it delivers                                                            | Key risk                                      |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 1. Seams and command | Token parameter, pure trace mapping, integration config + script            | Accidental behaviour change in the scheduler  |
| 2. Unit tables       | Trace mapping table; Warsaw boundary table with haversine oracle            | Oracle drifting back to the function's output |
| 3. Integration #1    | Fakes; exactly-one-alert; type matching; failures → `error`; CI + CLAUDE.md | Fake too clever (mirrors poller expectations) |
| 4. Integration #2    | Two-run dedup, 59/61 min, per-user, 400/403 cap, 429 stop                   | Asserting against the accepted next-run retry |
| 5. Cookbook          | §6.1, §6.2, §6.6, §4/§5 rows, roadmap Parked                                | Cookbook too vague to reuse                   |

**Prerequisites:** none beyond `npm ci`; no running services.
**Estimated effort:** ~2–3 implementation sessions across 5 phases.

## Open Risks & Assumptions

- The 60-minute window comes from the test plan and code; the PRD still lists the length as open question 4.
- Format drift in the ADS-B feed remains invisible in `cron_runs` until the parked product decision is taken.
- Mutation checks are manual (local, not committed); they prove the tests bite but are not repeated in CI.

## Success Criteria (Summary)

- Breaking the latitude correction, the type filter, the dedup insert/filters or the 400/403/429 limits turns a named
  test red.
- A reported edge failure can never produce an `ok` run unnoticed.
- A future contributor adds a boundary case or poller scenario from §6 alone.
