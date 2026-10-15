<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Middleware auth error observability

- **Plan**: context/changes/middleware-auth-error-observability/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-15
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

Automated checks were re-run during this review: `npm run lint` exit 0, `npm test` 125/125, `npm run test:integration` 23/23, and `astro check` with 0 errors, 0 warnings and 0 hints.

## Findings

### F1 — Non-JSON 429 or unlisted 5xx still redirects instead of 503

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-decision.ts:46-49
- **Detail**: In auth-js `handleError` (`node_modules/@supabase/auth-js/dist/main/lib/fetch.js:41-50`), a response whose body is not JSON and whose status is not in `NETWORK_ERROR_CODES` becomes an `AuthUnknownError`. Examples are an HTML 429 page from a proxy and a 505 or 507. That error has no `status` (`errors.js:79-85`), so `isRetryable` returns false. The request redirects to sign-in, though it is still logged at error level. Visibility (the core of A1) holds; only the 503 protection is missed for this case.
- **Fix A ⭐ Recommended**: Treat `name === "AuthUnknownError"` as retryable, and add a test row for it.
  - Strength: A non-JSON answer from GoTrue means infrastructure (a proxy or error page), not a rejected session, so 503 is the honest answer and sessions survive.
  - Tradeoff: A genuine one-off malformed response for a single user gets a 503 instead of a sign-in prompt. Retrying fixes it.
  - Confidence: MED — derived from auth-js source, not observed in production.
  - Blind spot: Whether other code paths in auth-js also raise `AuthUnknownError` for per-user conditions.
- **Fix B**: Leave as is and note it in the plan's Open Risks.
  - Strength: No code change; the case is rare and already logged.
  - Tradeoff: A proxy-level rate-limit burst still mass-redirects users.
  - Confidence: HIGH — the behaviour is fully understood.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — AuthUnknownError treated as retryable; test row added red-first

### F2 — A5 cookie check also matches the PKCE code-verifier cookie

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-decision.ts:89-97
- **Detail**: `hasSupabaseAuthCookie` matches any `sb-*` name containing `-auth-token`, which includes `sb-<ref>-auth-token-code-verifier`. The app signs in with a password (no PKCE), so that cookie should not appear. If it ever lingers, every anonymous hit on a private page would warn `auth.redirect_with_cookie`. The test table asserts the verifier cookie counts.
- **Fix**: Match only `sb-<ref>-auth-token` and its `.N` chunks, and flip that test row to `false`.
- **Decision**: FIXED — cookie check matches only sb-<ref>-auth-token(.N); verifier row flipped red-first

### F3 — Manual check 2.5 used a forged session, evidence not in repo

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/middleware-auth-error-observability/plan.md (Progress 2.5)
- **Detail**: Row 2.5 says "a signed-in private page answers 503". It was verified with a forged unexpired `sb-127-auth-token` cookie against an unreachable `SUPABASE_URL` (via a temporary `.dev.vars.outage` + `CLOUDFLARE_ENV=outage`), not with a real sign-in. The observed result was a 503 with `Retry-After: 30` and `no-store`, `/auth/signin` returning 200, and `AuthRetryableFetchError` status 0 logged. That exercises the same auth-js path, but the record exists only in the session transcript.
- **Fix**: Add a one-line note under Phase 2 Manual Verification describing how 2.5 was verified.
- **Decision**: FIXED — verification note added under Phase 2 Manual Verification
