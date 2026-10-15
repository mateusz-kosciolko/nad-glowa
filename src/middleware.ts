import { defineMiddleware } from "astro:middleware";
import { decideAuth, hasSupabaseAuthCookie } from "@/lib/auth-decision";
import { createClient } from "@/lib/supabase";

// Every route is private until it is added to this list. Matched exactly against the pathname
// (a trailing "/" is ignored); anonymous requests to any other path are redirected to sign-in.
const PUBLIC_ROUTES = ["/auth/signin", "/api/auth/signin", "/api/auth/signout"];

function isPublicRoute(pathname: string) {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return PUBLIC_ROUTES.includes(normalized);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const isPublic = isPublicRoute(context.url.pathname);

  if (!supabase) {
    context.locals.user = null;
    return isPublic ? next() : context.redirect("/auth/signin");
  }

  // getUser() returns auth errors (outage, 5xx, 429, network, bad key) instead of throwing them.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  context.locals.user = user ?? null;

  const decision = decideAuth({
    hasUser: user !== null,
    error,
    isPublicRoute: isPublic,
    hasAuthCookie: hasSupabaseAuthCookie(context.request.headers.get("Cookie")),
    method: context.request.method,
    path: context.url.pathname,
  });

  if (decision.log) {
    if (decision.log.level === "error") {
      // eslint-disable-next-line no-console -- Workers Logs is the only error channel; the line carries no secrets
      console.error(decision.log);
    } else {
      // eslint-disable-next-line no-console -- Workers Logs is the only error channel; the line carries no secrets
      console.warn(decision.log);
    }
  }

  if (decision.action === "unavailable") {
    return new Response("Sign-in service is temporarily unavailable. Please try again shortly.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  if (decision.action === "redirect") {
    return context.redirect("/auth/signin");
  }
  return next();
});
