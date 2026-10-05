// Telegram Bot API client: the only place that knows the API's endpoint and response format.
// The bot token is part of the request URL, so no error message returned from here may contain the URL or the token.

const API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export type TelegramSendResult = { ok: true } | { ok: false; httpStatus: number | null; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Defence in depth: runtimes may quote the request URL in network errors.
function redact(message: string, token: string): string {
  return token === "" ? message : message.split(token).join("[redacted]");
}

function describeFetchError(error: unknown, token: string): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `No response within ${TIMEOUT_MS / 1000} s`;
  }
  return redact(`Network error: ${error instanceof Error ? error.message : String(error)}`, token);
}

// Never throws: every failure comes back as `ok: false` with a readable error, e.g. Telegram's
// "Bad Request: chat not found" or "Forbidden: bot was blocked by the user".
export async function sendTelegramMessage(input: {
  token: string;
  chatId: number;
  text: string;
}): Promise<TelegramSendResult> {
  const { token, chatId, text } = input;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, httpStatus: null, error: describeFetchError(error, token) };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    // A timeout can also fire while the body is still streaming.
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, httpStatus: response.status, error: describeFetchError(error, token) };
    }
    // A non-JSON body is only a problem when the status does not already say it went wrong.
  }

  if (response.ok && isRecord(body) && body.ok === true) {
    return { ok: true };
  }

  const description = isRecord(body) && typeof body.description === "string" ? body.description.trim() : "";
  const error = description !== "" ? description : `Telegram responded with HTTP ${response.status}`;
  return { ok: false, httpStatus: response.status, error: redact(error, token) };
}
