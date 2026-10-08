import type { APIRoute } from "astro";
import { TELEGRAM_BOT_TOKEN } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { telegramErrorCode } from "@/lib/form-errors";
import { sendTelegramMessage } from "@/lib/telegram";

const TEST_MESSAGE = "Nad Głową test message: aircraft alerts will arrive in this chat.";

// A separate parameter, so the settings page shows the error next to the test button, not the save button.
// Only a code from src/lib/form-errors.ts goes into the URL; the settings page maps it to a fixed message.
function settingsError(code: string): string {
  return `/settings?telegram_error=${encodeURIComponent(code)}`;
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

  if (!TELEGRAM_BOT_TOKEN) {
    return context.redirect(settingsError("telegram_not_configured"));
  }

  // Read under RLS with the user's session, so only the caller's own chat ID can be used.
  const { data, error } = await supabase
    .from("alert_settings")
    .select("telegram_chat_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console -- server-side detail; the redirect carries only an error code
    console.error(`Loading alert settings for the Telegram test failed: ${error.message}`);
    return context.redirect(settingsError("load_failed"));
  }
  if (!data) {
    return context.redirect(settingsError("settings_missing"));
  }
  if (data.telegram_chat_id === null) {
    return context.redirect(settingsError("telegram_no_chat_id"));
  }

  const result = await sendTelegramMessage({
    token: TELEGRAM_BOT_TOKEN,
    chatId: data.telegram_chat_id,
    text: TEST_MESSAGE,
  });
  if (!result.ok) {
    const code = telegramErrorCode(result.error);
    if (code === "telegram_failed") {
      // sendTelegramMessage already strips the token from its error text.
      // eslint-disable-next-line no-console -- server-side detail; the redirect carries only an error code
      console.error(`Telegram test message failed: ${result.error}`);
    }
    return context.redirect(settingsError(code));
  }

  return context.redirect("/settings?telegram=sent");
};
