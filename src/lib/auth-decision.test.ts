import { describe, expect, it } from "vitest";
import { decideAuth, hasSupabaseAuthCookie, type AuthErrorLike, type AuthRequestFacts } from "@/lib/auth-decision";

const sessionMissing: AuthErrorLike = { name: "AuthSessionMissingError", status: 400 };
const networkFailure: AuthErrorLike = { name: "AuthRetryableFetchError", status: 0 };

function facts(overrides: Partial<AuthRequestFacts>): AuthRequestFacts {
  return {
    hasUser: false,
    error: null,
    isPublicRoute: false,
    hasAuthCookie: false,
    method: "GET",
    path: "/dashboard",
    ...overrides,
  };
}

describe("decideAuth", () => {
  it.each<[string, Partial<AuthRequestFacts>, "continue" | "redirect"]>([
    ["a missing session on a private route", { error: sessionMissing }, "redirect"],
    ["a missing session on a public route", { error: sessionMissing, isPublicRoute: true }, "continue"],
    ["no error and no user on a private route", {}, "redirect"],
    ["a signed-in user", { hasUser: true }, "continue"],
  ])("treats %s as before, without logging", (_label, overrides, action) => {
    expect(decideAuth(facts(overrides))).toEqual({ action, log: null });
  });

  it.each<[string, AuthErrorLike]>([
    ["a network failure", networkFailure],
    ["a GoTrue 503", { name: "AuthRetryableFetchError", status: 503 }],
    ["a GoTrue 500 API error", { name: "AuthApiError", status: 500, code: "unexpected_failure" }],
    ["a rate limit", { name: "AuthApiError", status: 429, code: "over_request_rate_limit" }],
  ])("answers 503 and logs an error for %s on a private route", (_label, error) => {
    expect(decideAuth(facts({ error, method: "POST", path: "/api/settings" }))).toEqual({
      action: "unavailable",
      log: {
        level: "error",
        event: "auth.get_user_failed",
        name: error.name,
        status: error.status,
        code: error.code ?? null,
        method: "POST",
        path: "/api/settings",
      },
    });
  });

  it("keeps public routes reachable during an outage but still logs the error", () => {
    const decision = decideAuth(facts({ error: networkFailure, isPublicRoute: true, path: "/auth/signin" }));
    expect(decision.action).toBe("continue");
    expect(decision.log).toMatchObject({ level: "error", event: "auth.get_user_failed", path: "/auth/signin" });
  });

  it.each<[string, AuthErrorLike]>([
    ["a rejected API key", { name: "AuthApiError", status: 401, code: "no_authorization" }],
    ["an unverifiable JWT", { name: "AuthApiError", status: 403, code: "bad_jwt" }],
    ["an unknown error", { name: "AuthUnknownError" }],
  ])("redirects and logs an error for %s", (_label, error) => {
    const decision = decideAuth(facts({ error }));
    expect(decision.action).toBe("redirect");
    expect(decision.log).toMatchObject({ level: "error", event: "auth.get_user_failed", name: error.name });
  });

  it.each([
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "session_expired",
    "user_not_found",
  ])("redirects and warns when the session is rejected with %s", (code) => {
    const decision = decideAuth(facts({ error: { name: "AuthApiError", status: 400, code }, hasAuthCookie: true }));
    expect(decision).toEqual({
      action: "redirect",
      log: {
        level: "warn",
        event: "auth.session_rejected",
        name: "AuthApiError",
        status: 400,
        code,
        method: "GET",
        path: "/dashboard",
      },
    });
  });

  it("warns when a request still carrying auth cookies is redirected to sign-in", () => {
    expect(decideAuth(facts({ error: sessionMissing, hasAuthCookie: true }))).toEqual({
      action: "redirect",
      log: {
        level: "warn",
        event: "auth.redirect_with_cookie",
        name: "AuthSessionMissingError",
        status: 400,
        code: null,
        method: "GET",
        path: "/dashboard",
      },
    });
  });

  it("does not warn about auth cookies on a public route", () => {
    expect(decideAuth(facts({ error: sessionMissing, hasAuthCookie: true, isPublicRoute: true }))).toEqual({
      action: "continue",
      log: null,
    });
  });
});

describe("hasSupabaseAuthCookie", () => {
  it.each<[string | null, boolean]>([
    ["sb-127-auth-token=abc", true],
    ["theme=dark; sb-127-auth-token.0=abc; sb-127-auth-token.1=def", true],
    ["sb-abcd-auth-token-code-verifier=xyz", true],
    ["theme=dark; sb-something=1", false],
    ["", false],
    [null, false],
  ])("reads %j as %s", (header, expected) => {
    expect(hasSupabaseAuthCookie(header)).toBe(expected);
  });
});
