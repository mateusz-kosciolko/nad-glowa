<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Dostęp tylko dla zaproszonych (S-01)

- **Plan**: context/changes/invite-only-access/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated checks re-run on 2026-10-08:

- Phase 1: lint, 26 unit tests, `astro check` (0 errors) and build pass; grep finds no sign-up traces in `src`; local `/auth/v1/signup` returns 422; `npm run smoke` passes; `npm run test:db` passes.
- Phase 2: `db push --dry-run` reports "Remote database is up to date"; on production anonymous `/`, `/dashboard` and `/auth/signup` return 302 to `/auth/signin`, and `/auth/signin` returns 200.

Middleware: no bypass found. Exact-match public paths fail closed for every variant tried with curl: trailing slash, `//`, `%2F`, case, `..`, `;`, `%00`, internal routes, HEAD. Unplanned changes (comments, "Signed in as", `URL` global in ESLint, defensive cleanup in smoke) were needed to pass the plan's own gates.

## Findings

### F1 — Smoke leaves an orphan account when interrupted

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:197-231
- **Detail**: The test account is deleted in `finally`, but Ctrl+C or SIGTERM skips `finally`, leaving a `smoke-<ts>@example.com` account in the local Supabase. Only local clutter, but this is exactly what the change set out to stop (criterion 1.9).
- **Fix**: Register `SIGINT`/`SIGTERM` handlers that run the same cleanup (delete created ids) and then `process.exit(130)`.
- **Decision**: FIXED — SIGINT/SIGTERM run the same cleanup and exit 130 (scripts/smoke.mjs); verified: interrupted run left no smoke-* account.

### F2 — Plan does not record two implementation adaptations

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/invite-only-access/plan.md:125, README.md:158
- **Detail**: The item 4 contract still says `enable_signup = false` "w `[auth]` i w `[auth.email]`". It is the only text left that tells anyone to disable `[auth.email]`, which in local GoTrue turns off email login. Item 2 still says `index.astro` with `Astro.redirect`; the code uses the `src/pages/index.ts` endpoint (ESLint crashed on a top-level `return`), with the same behaviour for GET. README mentions `enable_signup = false` without naming the section or giving the caveat.
- **Fix**: Add an "Odchylenia od planu" note to plan.md (config `[auth.email]` stays true; `/` is `index.ts`) and add "in `[auth]` (not `[auth.email]`, which would disable email login)" to README:158.
- **Decision**: FIXED — "Odchylenia od planu" section in plan.md; README names the [auth] section and the [auth.email] caveat.

### F3 — CLAUDE.md contradicts itself on who creates accounts

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: CLAUDE.md:11
- **Detail**: Line 11 says accounts are created "only in the Supabase dashboard". The line above allows `scripts/smoke.mjs` to create accounts through the Admin API.
- **Fix**: Reword to "only by an administrator (Supabase dashboard; locally also the smoke script via Admin API)".
- **Decision**: FIXED — CLAUDE.md:11 says accounts are created by an administrator in the dashboard; locally smoke via Admin API.

### F4 — The service_role exception for scripts is not enforced by ESLint

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js (scripts config), CLAUDE.md:10
- **Detail**: ESLint's service-key rules cover only `src/**`. Any script in `scripts/` can read `process.env.SUPABASE_SERVICE_KEY` without a lint error. The CLAUDE.md exception names only `smoke.mjs`, but nothing enforces that.
- **Fix**: Add `no-restricted-syntax` on `process.env.SUPABASE_SERVICE_KEY` for `scripts/**`, with an override that allows it in `scripts/smoke.mjs`.
  - Strength: Lint enforces the hard rule the same way as in `src/`.
  - Tradeoff: One more ESLint config block; a future script that legitimately needs the key needs its own override.
  - Confidence: HIGH — the same mechanism already guards `src/`.
  - Blind spot: Access patterns other than `process.env.X` (destructuring, `process.env["X"]`) need extra selectors.
- **Decision**: FIXED — eslint.config.js: no-restricted-syntax on process.env.SUPABASE_SERVICE_KEY (member, computed, destructuring) for scripts/**, off for scripts/smoke.mjs; verified it fires 3× on a probe script.

### F5 — Host guard does not prove the key belongs to a local instance

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:20-32
- **Detail**: The guard checks that `SUPABASE_URL` is local, not the key. A localhost tunnel to a remote project with a real service key would pass. Very unlikely; README already says never to use production.
- **Fix**: Skip; README already warns ("never point it at production"). Revisit if anyone sets up a tunnel to a remote project.
- **Decision**: FIXED — smoke also requires the service key to be the local CLI demo key (JWT iss "supabase-demo"); verified it refuses a fake key.

### F6 — Sign-out redirects to `/` (two hops)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signout.ts:9
- **Detail**: `signin.ts` was changed to redirect straight to `/dashboard`, but sign-out still goes to `/`, which now only bounces the anonymous user to `/auth/signin`.
- **Fix**: Redirect sign-out to `/auth/signin` and update the smoke step "signout clears session" (expects `location: "/"`).
- **Decision**: FIXED — sign-out redirects to /auth/signin; smoke step updated.
