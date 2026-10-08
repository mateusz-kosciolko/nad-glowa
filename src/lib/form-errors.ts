// Error codes for the settings and dashboard redirects (`?error=`, `?telegram_error=`, `?alerts_error=`).
// A redirect carries only a code; the page shows the fixed message from this catalog, never the parameter itself,
// so a crafted link cannot put its own text on the page. Pure module: no server-only imports.
import { VALIDATION_MESSAGES } from "@/lib/alert-settings";

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

const ERROR_MESSAGES: Record<string, string> = {
  ...VALIDATION_MESSAGES,
  supabase_not_configured: "Supabase is not configured",
  settings_missing: "Your settings record is missing. Please contact support.",
  save_failed: "Could not save your settings. Please try again.",
  load_failed: "Could not load your settings. Please try again.",
  telegram_not_configured: "The Telegram bot is not configured on this server",
  telegram_no_chat_id: "Save your Telegram chat ID first",
  telegram_chat_not_found: "Telegram: chat not found. Check the chat ID and press Start in your bot.",
  telegram_blocked: "Telegram: the bot was blocked. Unblock it in Telegram and try again.",
  telegram_failed: "Could not send the Telegram message. Please try again later.",
};

// null when there is no code; an unknown code gets the generic message.
export function messageForCode(code: string | null): string | null {
  if (code === null || code === "") {
    return null;
  }
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : GENERIC_ERROR_MESSAGE;
}

export type TelegramErrorCode = "telegram_chat_not_found" | "telegram_blocked" | "telegram_failed";

// Maps Telegram's error description (e.g. "Bad Request: chat not found") to a code.
export function telegramErrorCode(description: string): TelegramErrorCode {
  const text = description.toLowerCase();
  if (text.includes("chat not found")) {
    return "telegram_chat_not_found";
  }
  if (text.includes("bot was blocked by the user")) {
    return "telegram_blocked";
  }
  return "telegram_failed";
}
