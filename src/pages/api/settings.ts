import type { APIRoute } from "astro";
import { parseAlertSettingsForm } from "@/lib/alert-settings";
import { createClient } from "@/lib/supabase";

// Only a code from src/lib/form-errors.ts goes into the URL; the settings page maps it to a fixed message.
function settingsError(code: string): string {
  return `/settings?error=${encodeURIComponent(code)}`;
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsError("supabase_not_configured"));
  }

  const parsed = parseAlertSettingsForm(await context.request.formData());
  if (!parsed.ok) {
    return context.redirect(settingsError(parsed.code));
  }

  const { data, error } = await supabase
    .from("alert_settings")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    // eslint-disable-next-line no-console -- server-side detail; the redirect carries only an error code
    console.error(`Saving alert settings failed: ${error.message}`);
    return context.redirect(settingsError("save_failed"));
  }
  // The row is created by a trigger when the account is created in the Supabase dashboard (or by the migration
  // backfill); none means that step failed.
  if (data.length === 0) {
    return context.redirect(settingsError("settings_missing"));
  }

  return context.redirect("/settings?saved=1");
};
