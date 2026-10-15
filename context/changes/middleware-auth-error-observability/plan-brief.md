# Middleware auth error observability — Plan Brief

> Full plan: `context/changes/middleware-auth-error-observability/plan.md`

## What & Why

`supabase.auth.getUser()` returns its errors instead of throwing them, and the middleware reads only `user`. An Auth outage, a 5xx, a 429, a network failure or a rotated anon key therefore silently redirects every signed-in user to sign-in, losing any form POST and leaving no log. This is audit finding A1, the top item in the 2026-10-15 observability report.

## Starting Point

`src/middleware.ts:16-27` treats `user == null` as anonymous, whatever the cause. There is no error tracker: only `console.*` reaches Cloudflare Workers Logs.

## Desired End State

Anonymous requests behave exactly as today. Outages answer 503 on private routes and log at error level. Per-user session problems and redirects of requests that still carry `sb-*` auth cookies log at warn. Each line carries the error name, status, code, method and path, and never the email, tokens or message.

## Key Decisions Made

| Decision               | Choice                                                                                                                                                | Why (1 sentence)                                                                              | Source                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| Where the logic lives  | Pure `src/lib/auth-decision.ts`                                                                                                                       | Vitest can test it without `astro:*` or Supabase.                                             | Brief                      |
| Anonymous detection    | `AuthSessionMissingError` by name, not logged                                                                                                         | Same check auth-js uses; logging it would turn every anonymous hit into noise.                | Brief                      |
| Retryable set          | `AuthRetryableFetchError`, status ≥ 500, **and 429**                                                                                                  | A rate-limit burst should not bounce users and drop their POSTs.                              | Plan (user)                |
| Per-user 4xx level     | warn for `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired`, `user_not_found`; error for everything else | Keeps error level a real-outage signal; `bad_jwt` / 401 stay error because they hit everyone. | Plan (user)                |
| Public routes on error | Log, continue with `user = null`                                                                                                                      | Sign-in and sign-out must stay reachable.                                                     | Plan                       |
| A5                     | warn `auth.redirect_with_cookie` when a redirected request has `sb-*-auth-token*`                                                                     | Makes "login works, then bounced" loops visible.                                              | Brief (optional, included) |
| Log shape              | One structured object, no message                                                                                                                     | Workers Logs indexes the fields; the message may echo provider text.                          | Plan                       |

## Scope

**In scope:** the decision module and its tests, middleware wiring, a 503 with `Retry-After: 30` and `Cache-Control: no-store`, and the A5 warn.

**Out of scope:** a shared `logError` helper (fix #2), sign-in and sign-out error handling (A2, A3, A6), page-level clients (A7, A8), skipping `getUser` on public routes, and a 503 page.

## Architecture / Approach

The middleware gathers the facts it has (`hasUser`, `error`, `isPublicRoute`, `hasAuthCookie`, `method`, `path`) and calls `decideAuth()`. That returns `continue | redirect | unavailable` plus an optional log line, and the middleware logs and responds accordingly.

## Phases at a Glance

| Phase                              | What it delivers                                                   | Key risk                                               |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| 1. Pure auth decision module (TDD) | `decideAuth` + `hasSupabaseAuthCookie` with a red→green test table | Misclassifying session-missing as an error → log noise |
| 2. Wire into middleware and verify | 503 + logs live; lint, tests and astro check green                 | Breaking the anonymous redirect or public routes       |

**Prerequisites:** none.
**Estimated effort:** one short session.

## Open Risks & Assumptions

- The error name and code strings are auth-js internals, pinned by `@supabase/supabase-js ^2.99`. A rename would degrade gracefully into error-level logs, not into a lockout.
- 503 bodies are plain text. A form POST during an outage shows a bare page, but the session survives.

## Success Criteria (Summary)

- During an Auth outage signed-in users get a 503 they can retry, and Workers Logs shows why.
- Anonymous visitors see no change and produce no log lines.
