# Middleware auth error observability Implementation Plan

## Overview

Make `src/middleware.ts` read the `error` returned by `supabase.auth.getUser()` and stop sending everyone to sign-in without a trace when that call fails. This fixes observability finding A1 (critical), plus A5 and part of A9, from `context/audits/observability/2026-10-15_alert-poll-alert-settings-auth.md`. The decision logic moves into a pure `src/lib` module so Vitest can prove it.

## Current State Analysis

- `src/middleware.ts:16-21` destructures only `data.user` from `getUser()`. If it is `null`, any non-public request is 302'd to `/auth/signin` (`middleware.ts:25-27`). Nothing is logged.
- auth-js does not throw `AuthError`s from `getUser()`. It returns `{ data: { user: null }, error }` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2719-2726`). As a result, an Auth outage, a 5xx, a 429, a network failure or a rotated anon key all look exactly like "anonymous".
- Error shapes (`node_modules/@supabase/auth-js/dist/main/lib/errors.js`, `lib/fetch.js`):
  - No session cookie: `AuthSessionMissingError`, status 400 (`errors.js:115-119`). This is the expected anonymous case.
  - Network failure: `AuthRetryableFetchError`, status 0 (`fetch.js:38`). A 5xx from GoTrue is the same error with the HTTP status (`fetch.js:45-53`).
  - Other HTTP errors: `AuthApiError` with `status` and `code`, for example 429 `over_request_rate_limit`, 401 bad API key, 400 `refresh_token_not_found`.
- auth-js's own predicates check only `error.name` (`errors.js:121-123, 244-246`). A pure module can duck-type `{ name, status, code }` with the same precision and without importing Supabase, which CLAUDE.md forbids in unit-tested modules.
- Pure-module pattern to follow: `src/lib/cron-runs.ts` + `src/lib/cron-runs.test.ts` (`it.each` tables, explicit `vitest` imports, no `astro:*`).

## Desired End State

- An anonymous request (`AuthSessionMissingError`, or no error and no user) behaves exactly as today: a 302 to `/auth/signin` on private routes, pass-through on public routes. No log line, except the A5 warn below.
- A retryable failure on a private route answers **503** with `Retry-After` and `Cache-Control: no-store`, not the sign-in redirect, and logs at `console.error`. Retryable means `AuthRetryableFetchError`, status ≥ 500, or status 429.
- Known per-user session errors log at `console.warn` and redirect as before. These are `AuthApiError` with code `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired` or `user_not_found`.
- Every other error (for example a 401 bad API key, `bad_jwt`, or an unknown code) logs at `console.error` and redirects.
- A5: a request carrying an `sb-*-auth-token*` cookie that is redirected to sign-in logs at `console.warn`.
- Every log line is one structured object with `event`, `name`, `status`, `code`, `method` and `path`. It never contains email, tokens, cookie values or the error message.
- On public routes an error is still logged, but the request continues with `user = null`, so sign-in and sign-out stay reachable.

### Key Discoveries:

- `GoTrueClient.js:2719-2726`: `getUser()` maps every `AuthError` to `{ user: null, error }`.
- `fetch.js:38`: status 0 means a network failure, so "retryable" cannot be keyed on status alone. It also needs the name check.
- The `@supabase/ssr` cookie name is `sb-<ref>-auth-token`, optionally chunked as `.0` and `.1`. The PKCE verifier cookie is `sb-<ref>-auth-token-code-verifier`. Locally the ref is `127`.

## What We're NOT Doing

- No shared `logError(event, err, ctx)` helper. That is audit fix #2, a separate change.
- No change to sign-in, sign-out or page-level clients (A2, A3, A6, A7, A8).
- No `getUser()` skip on public routes. A9 is only partly addressed: the error is now logged on public routes, but latency is not recorded.
- No custom 503 page. A plain-text body is enough for this change.
- No logging of `error.message`. It can echo provider text, and the name, status and code identify the failure.

## Implementation Approach

Write one pure function that takes everything the middleware knows and returns what it should do, plus an optional log line. The middleware only performs that verdict. Phase 1 drives the function test-first. Phase 2 wires it in.

## Phase 1: Pure auth decision module (TDD)

### Overview

Add `src/lib/auth-decision.ts` and its Vitest table, red first.

### Changes Required:

#### 1. Decision module

**File**: `src/lib/auth-decision.ts`

**Intent**: Classify the `getUser()` outcome and decide whether to continue, redirect to sign-in or answer 503, plus which line (if any) to log. No `astro:*` or Supabase imports.

**Contract**:

```ts
export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
}
export interface AuthRequestFacts {
  hasUser: boolean;
  error: AuthErrorLike | null;
  isPublicRoute: boolean;
  hasAuthCookie: boolean;
  method: string;
  path: string;
}
export interface AuthLogLine {
  level: "error" | "warn";
  event: "auth.get_user_failed" | "auth.session_rejected" | "auth.redirect_with_cookie";
  name: string | null;
  status: number | null;
  code: string | null;
  method: string;
  path: string;
}
export type AuthDecision =
  | { action: "continue"; log: AuthLogLine | null }
  | { action: "redirect"; log: AuthLogLine | null }
  | { action: "unavailable"; log: AuthLogLine };
export function decideAuth(facts: AuthRequestFacts): AuthDecision;
export function hasSupabaseAuthCookie(cookieHeader: string | null): boolean;
```

Rules, in order:

1. A user is present → `continue`, no log.
2. No error, or `name === "AuthSessionMissingError"` → anonymous.
3. Retryable (`AuthRetryableFetchError`, status ≥ 500, or status 429) → error-level `auth.get_user_failed`. Private route → `unavailable`; public route → `continue`.
4. A per-user session code from the allowlist → warn-level `auth.session_rejected`.
5. Anything else → error-level `auth.get_user_failed`.
6. Anonymous, or a case from rule 4 or 5, on a public route → `continue`. On a private route → `redirect`.
7. A redirect with no log yet, where `hasAuthCookie` is true → warn-level `auth.redirect_with_cookie` (A5).

`hasSupabaseAuthCookie` is true when any cookie name starts with `sb-` and contains `-auth-token`.

#### 2. Regression tests

**File**: `src/lib/auth-decision.test.ts`

**Intent**: Prove the 503 + error-log path and the unchanged anonymous path, plus the warn cases and the cookie detection. Assert that the log line has no message or email field.

**Contract**: `it.each` tables in the `cron-runs.test.ts` style. Cases:

- Session-missing on a private route: redirect, no log.
- Session-missing on a public route: continue, no log.
- `AuthRetryableFetchError` status 0, and 503: unavailable plus error log with name, status, method and path.
- 429 `over_request_rate_limit`: unavailable.
- Retryable on a public route: continue plus error log.
- 401 `no_authorization` and `bad_jwt`: redirect plus error log.
- `refresh_token_not_found`: redirect plus warn `auth.session_rejected`.
- Session-missing with an auth cookie: redirect plus warn `auth.redirect_with_cookie`.
- User present: continue, no log.
- Cookie parsing: `sb-127-auth-token.0`, a PKCE verifier cookie, unrelated cookies, and an empty or null header.

### Success Criteria:

#### Automated Verification:

- New tests fail before the module exists (red), then pass: `npm test`
- Lint passes: `npm run lint`

---

## Phase 2: Wire into middleware and verify

### Overview

Replace the ad-hoc check in `src/middleware.ts` with `decideAuth`, emit the log line, and return the 503.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts`

**Intent**: Read `error` from `getUser()`, build the facts (keep `isPublicRoute` local, and read the cookie header from `context.request.headers`), call `decideAuth`, and log with `console.error` or `console.warn` as one object. Map `redirect` to the existing sign-in redirect, and `unavailable` to `new Response(…, { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } })`. When `createClient()` returns `null` (Supabase not configured), keep today's behaviour. `context.locals.user` is still set before any response.

**Contract**: `onRequest` keeps its signature. Log call shape: `console[level](JSON-able object)`, with no message string interpolating error text.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Integration tests pass: `npm run test:integration`
- Lint passes: `npm run lint`
- Type check passes: `npx astro sync && npx astro check`

#### Manual Verification:

- With the dev server pointed at an unreachable `SUPABASE_URL`, a signed-in private page answers 503 and the terminal shows the `auth.get_user_failed` line

---

## Testing Strategy

### Unit Tests:

- `decideAuth` decision table (all rule branches, public vs private).
- `hasSupabaseAuthCookie` parsing edge cases.

### Manual Testing Steps:

1. Run `npm run dev`, sign in, then set `SUPABASE_URL` in `.dev.vars` to `http://127.0.0.1:1` and restart.
2. Request `/dashboard`: expect a 503 with `Retry-After`, plus an error log with `name: AuthRetryableFetchError` and `status: 0`.
3. Request `/auth/signin`: expect the page to render, with the error logged.

## References

- Audit: `context/audits/observability/2026-10-15_alert-poll-alert-settings-auth.md` (A1, A5, A9; fix order #1)
- Pattern: `src/lib/cron-runs.ts`, `src/lib/cron-runs.test.ts`
- auth-js: `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2719-2726`, `lib/errors.js`, `lib/fetch.js:38-53`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure auth decision module (TDD)

#### Automated

- [x] 1.1 New tests fail before the module exists (red), then pass: `npm test` — e0c7625
- [x] 1.2 Lint passes: `npm run lint` — e0c7625

### Phase 2: Wire into middleware and verify

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — e0c7625
- [x] 2.2 Integration tests pass: `npm run test:integration` — e0c7625
- [x] 2.3 Lint passes: `npm run lint` — e0c7625
- [x] 2.4 Type check passes: `npx astro sync && npx astro check` — e0c7625

#### Manual

- [x] 2.5 With the dev server pointed at an unreachable `SUPABASE_URL`, a signed-in private page answers 503 and the terminal shows the `auth.get_user_failed` line — e0c7625
