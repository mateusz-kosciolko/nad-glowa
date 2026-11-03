import type { APIRoute } from "astro";
import { parseAlertIdForm } from "@/lib/alert-history";
import { createClient } from "@/lib/supabase";

// Only a code from src/lib/form-errors.ts goes into the URL; the page maps it to a fixed message.
function historyError(code: string): string {
  return `/alerts?alerts_error=${encodeURIComponent(code)}`;
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(historyError("supabase_not_configured"));
  }

  const parsed = parseAlertIdForm(await context.request.formData());
  if (!parsed.ok) {
    return context.redirect(historyError(parsed.code));
  }

  // Under RLS with the user's session: the policy removes only the caller's own entries older than the dedup window.
  const { data, error } = await supabase
    .from("alert_notifications")
    .delete()
    .eq("id", parsed.id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    // eslint-disable-next-line no-console -- server-side detail; the redirect carries only an error code
    console.error(`Deleting an alert history entry failed: ${error.message}`);
    return context.redirect(historyError("alert_delete_failed"));
  }
  // RLS filters instead of raising: nothing removed means it is too recent, already gone or not the caller's.
  if (data.length === 0) {
    return context.redirect(historyError("alert_not_deletable"));
  }

  return context.redirect("/alerts?deleted=1");
};
