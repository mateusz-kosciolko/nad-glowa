<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Test rollout Phase 1 — Poller critical path

- **Plan**: context/changes/testing-poller-critical-path/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: every planned file is in `git diff cbb2457..HEAD`, and no unplanned source file is. The only production changes are the two seams (the token parameter and `describeRunOutcome`), and they are behaviour-equivalent. Every Automated command passes again on 2026-10-10: lint, astro check, `npm test` (99), `npm run test:integration` (23, 1.5 s), build, the `astro:env` grep, the `TBD` grep and the Prettier check. The integration suite also passes under `TZ=America/New_York`. All mutation checks (Phases 2–4) turned the named tests red during implementation. Every Manual item has evidence: 1.6 a `cron_runs` row with `ok` from `cron:local`; 2.4 to 5.4 reviewed in session and accepted by the user. The `poller-fakes.ts` module is not reachable from the Worker entry, and the service_role boundary is intact.

## Findings

### F1 — No test guards "error strings never carry token / chat ID / home"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/workers/alert-poller.integration.test.ts:171-194, :292-320
- **Detail**: The header comment of `alert-poller.ts:4-5` promises that error strings, which reach `cron_runs.error` and the logs, never contain home coordinates, chat IDs or the bot token. The new failure scenarios have all three values at hand (`TOKEN`, `DEFAULT_CHAT_ID`, `SECOND_USER.telegram_chat_id`, `HOME`) but never assert their absence, so a regression that interpolates one of them into an error would pass.
- **Fix**: In the failures table and the Telegram 400/403/500/429 cases, assert that `summary.errors.join("\n")` contains none of `TOKEN`, the chat IDs as strings, `String(HOME.lat)` or `String(HOME.lon)`.
- **Decision**: FIXED — `expectNoSecretsIn(summary.errors)` added to the failures table, the 400/403/500 cases and the 429 case (token, both chat IDs, HOME lat/lon); break-check: putting the chat ID into the per-user error turned 11 tests red.

### F2 — Multi-user scenarios wait the real 1.1 s ADS-B gap

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/workers/alert-poller.ts:112-117 (used by alert-poller.integration.test.ts:267)
- **Detail**: The plan deliberately avoided fake timers ("Performance Considerations") and capped scenarios at ≤ 2 users (§6.2). Today the suite takes 1.5 s, almost all of it this one wait. Each future multi-user scenario adds about 1.1 s of wall-clock time per extra user. Rollout Phase 2 (risk #3, edge latency) is where timing control would naturally arrive.
- **Fix A ⭐ Recommended**: Keep as is; revisit in rollout Phase 2 (latency/timeouts), which needs timing control anyway.
  - Strength: No production change now; matches the plan's explicit decision and the documented ≤ 2-user rule.
  - Tradeoff: Suite time grows linearly if someone ignores §6.2.
  - Confidence: HIGH — the current cost is 1.5 s total.
  - Blind spot: None significant.
- **Fix B**: Inject a `sleep` (or the gap) into `runAlertPoll` like the clock, with a no-op in tests.
  - Strength: Removes the wall-clock dependence completely.
  - Tradeoff: Another production seam and signature change, outside this plan's scope.
  - Confidence: MED — simple, but the latency tests of Phase 2 may want a different shape.
  - Blind spot: How Phase 2's timeout scenarios will want to control time.
- **Decision**: ACCEPTED via Fix A — keep the real 1.1 s gap (plan decision, ≤ 2 users per scenario); revisit in test rollout Phase 2 (latency).

### F3 — `fetch` stub restore depends on each file's `afterEach`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.integration.config.ts:14-17, src/workers/poller-fakes.ts:151
- **Detail**: `vi.unstubAllGlobals()` runs in the test file's `afterEach` (`alert-poller.integration.test.ts:47-51`). A second integration file that forgets it would leak the stub into later tests.
- **Fix**: Add `unstubGlobals: true` to the integration config's `test` block (keep the explicit `afterEach`, which also checks `http.unexpected`).
- **Decision**: FIXED — `unstubGlobals: true` in vitest.integration.config.ts; the explicit afterEach (with the `http.unexpected` check) stays.

### F4 — A thrown run error is stored without the 500-character cap

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/cron-runs.ts:18-21
- **Detail**: `describeRunOutcome({ thrown })` returns the full message, while collected errors are cut to `MAX_RUN_ERROR_CHARS`. This faithfully preserves the old behaviour (a correct refactor), but the constant's name suggests it bounds every run error.
- **Fix**: Optional deliberate behaviour change: also `.slice(0, MAX_RUN_ERROR_CHARS)` the thrown message and add a table row in `cron-runs.test.ts`.
- **Decision**: FIXED — the thrown message is cut to MAX_RUN_ERROR_CHARS too (a deliberate behaviour change); new row 'cuts a long thrown message to exactly 500 characters'; break-check red without the cut.

### F5 — Test-plan prose slightly stale (§4 intro, §6.2 duration)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:75-77, :159
- **Detail**: The §4 intro still says "6 plików unit … brak testów … pollera". There are now 7 unit files and a poller integration suite. The plan only asked for the §4 rows to change. §6.2 says "ok. 2,5 s", but the measured run is about 1.5 s; 2.5 s was the npm wall time.
- **Fix**: Update the §4 intro sentence (the baseline profile) and change "ok. 2,5 s" to "ok. 1,5–2,5 s", or leave both for `/10x-test-plan --refresh`.
- **Decision**: FIXED — §4 intro: post-Phase-1 state appended (7 unit files + poller integration); §6.2 duration 'ok. 1,5 s'; §6.1 helper name updated to kmToLatDeg (follows F6).

### F6 — `warsawLatOffsetDeg` duplicates `kmToLatDeg`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/flyover.test.ts:32 vs. the Warsaw block's `warsawLatOffsetDeg`
- **Detail**: Both compute `km / R` in degrees. The Warsaw copy carries the meridian-arc derivation comment, which is useful for the oracle, but the logic is duplicated.
- **Fix**: Reuse `kmToLatDeg` in the Warsaw block and move the "dLat = D / R (meridian arc)" comment onto it.
- **Decision**: FIXED — warsawLatOffsetDeg removed; the Warsaw block uses kmToLatDeg, which now carries the meridian-arc derivation comment.
