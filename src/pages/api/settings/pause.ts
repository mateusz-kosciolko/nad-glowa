import type { APIRoute } from "astro";
import { parsePauseForm } from "@/lib/alert-settings";
import { createClient } from "@/lib/supabase";

// The pause switch lives on the dashboard, so errors go back there, not to /settings.
// Only a code from src/lib/form-errors.ts goes into the URL; the dashboard maps it to a fixed message.
function dashboardError(code: string): string {
  return `/dashboard?alerts_error=${encodeURIComponent(code)}`;
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(dashboardError("supabase_not_configured"));
  }

  const parsed = parsePauseForm(await context.request.formData());
  if (!parsed.ok) {
    return context.redirect(dashboardError(parsed.code));
  }

  // Under RLS with the user's session: only the caller's own row can change. Other settings stay untouched.
  const { data, error } = await supabase
    .from("alert_settings")
    .update({ paused: parsed.paused, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    // eslint-disable-next-line no-console -- server-side detail; the redirect carries only an error code
    console.error(`Saving the alert pause state failed: ${error.message}`);
    return context.redirect(dashboardError("save_failed"));
  }
  // The row is created by a trigger when the account is created; none means that step failed.
  if (data.length === 0) {
    return context.redirect(dashboardError("settings_missing"));
  }

  return context.redirect(`/dashboard?alerts=${encodeURIComponent(parsed.paused ? "paused" : "resumed")}`);
};
