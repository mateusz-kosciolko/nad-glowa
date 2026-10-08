import { defineMiddleware } from "astro:middleware";
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

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (!context.locals.user && !isPublicRoute(context.url.pathname)) {
    return context.redirect("/auth/signin");
  }

  return next();
});
