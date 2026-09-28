import type { APIRoute } from "astro";
import { parseAlertSettingsForm } from "@/lib/alert-settings";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/settings?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const parsed = parseAlertSettingsForm(await context.request.formData());
  if (!parsed.ok) {
    return context.redirect(`/settings?error=${encodeURIComponent(parsed.error)}`);
  }

  const { data, error } = await supabase
    .from("alert_settings")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    return context.redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }
  // The row is created by the signup trigger (or the migration backfill); none means that step failed.
  if (data.length === 0) {
    return context.redirect(
      `/settings?error=${encodeURIComponent("Your settings record is missing. Please contact support.")}`,
    );
  }

  return context.redirect("/settings?saved=1");
};
