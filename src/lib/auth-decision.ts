// Decides what the middleware does with the result of supabase.auth.getUser(). Pure: no astro:* or Supabase
// imports, so it reads auth-js errors structurally ({ name, status, code }), the same fields auth-js's own
// isAuthSessionMissingError / isAuthRetryableFetchError predicates check.

export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
}

export interface AuthRequestFacts {
  hasUser: boolean;
  // The `error` getUser() returned; auth-js returns AuthErrors instead of throwing them.
  error: AuthErrorLike | null;
  isPublicRoute: boolean;
  hasAuthCookie: boolean;
  method: string;
  path: string;
}

// Never carries the error message, email, tokens or cookie values.
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

// One user's session is gone or invalid; signing in again fixes it, so it is not an outage.
const SESSION_REJECTED_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
]);

// Auth is down or throttling: network failure (status 0), 5xx or 429. Redirecting would sign everyone out.
function isRetryable(error: AuthErrorLike): boolean {
  const status = error.status ?? 0;
  return error.name === "AuthRetryableFetchError" || status >= 500 || status === 429;
}

export function decideAuth(facts: AuthRequestFacts): AuthDecision {
  const { error } = facts;
  if (facts.hasUser) {
    return { action: "continue", log: null };
  }

  const line = (level: AuthLogLine["level"], event: AuthLogLine["event"]): AuthLogLine => ({
    level,
    event,
    name: error?.name ?? null,
    status: error?.status ?? null,
    code: error?.code ?? null,
    method: facts.method,
    path: facts.path,
  });

  let log: AuthLogLine | null = null;
  if (error && error.name !== "AuthSessionMissingError") {
    if (isRetryable(error)) {
      const failed = line("error", "auth.get_user_failed");
      return facts.isPublicRoute ? { action: "continue", log: failed } : { action: "unavailable", log: failed };
    }
    log =
      error.code !== undefined && SESSION_REJECTED_CODES.has(error.code)
        ? line("warn", "auth.session_rejected")
        : line("error", "auth.get_user_failed");
  }

  if (facts.isPublicRoute) {
    return { action: "continue", log };
  }
  if (!log && facts.hasAuthCookie) {
    log = line("warn", "auth.redirect_with_cookie");
  }
  return { action: "redirect", log };
}

// @supabase/ssr stores the session as sb-<ref>-auth-token (chunked as .0, .1, …) plus a PKCE code-verifier cookie.
export function hasSupabaseAuthCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) {
    return false;
  }
  return cookieHeader.split(";").some((pair) => {
    const name = pair.split("=", 1)[0].trim();
    return name.startsWith("sb-") && name.includes("-auth-token");
  });
}
