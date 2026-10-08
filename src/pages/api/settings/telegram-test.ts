import type { APIRoute } from "astro";
import { TELEGRAM_BOT_TOKEN } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

const TEST_MESSAGE = "Nad Głową test message: aircraft alerts will arrive in this chat.";

// A separate parameter, so the settings page shows the error next to the test button, not the save button.
function settingsError(message: string): string {
  return `/settings?telegram_error=${encodeURIComponent(message)}`;
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(settingsError("Supabase is not configured"));
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return context.redirect(settingsError("The Telegram bot is not configured on this server"));
  }

  // Read under RLS with the user's session, so only the caller's own chat ID can be used.
  const { data, error } = await supabase
    .from("alert_settings")
    .select("telegram_chat_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return context.redirect(settingsError(`Could not load your settings: ${error.message}`));
  }
  if (!data) {
    return context.redirect(settingsError("Your settings record is missing. Please contact support."));
  }
  if (data.telegram_chat_id === null) {
    return context.redirect(settingsError("Save your Telegram chat ID first"));
  }

  const result = await sendTelegramMessage({
    token: TELEGRAM_BOT_TOKEN,
    chatId: data.telegram_chat_id,
    text: TEST_MESSAGE,
  });
  if (!result.ok) {
    return context.redirect(settingsError(`Telegram: ${result.error}`));
  }

  return context.redirect("/settings?telegram=sent");
};
