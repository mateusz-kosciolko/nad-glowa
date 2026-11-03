// Alert history rules for the /alerts page and its delete endpoint. Pure logic, no server-only imports.
import { ALERT_TIME_ZONE, DEDUP_WINDOW_MS } from "@/lib/alerts";

export type AlertIdParseResult = { ok: true; id: number } | { ok: false; code: "alert_id_invalid" };

const ALERT_ID_PATTERN = /^[1-9]\d*$/;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ALERT_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function parseAlertIdForm(form: FormData): AlertIdParseResult {
  const value = form.get("id");
  if (typeof value !== "string" || !ALERT_ID_PATTERN.test(value)) {
    return { ok: false, code: "alert_id_invalid" };
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? { ok: true, id } : { ok: false, code: "alert_id_invalid" };
}

export function deletableAt(sentAt: string): Date {
  return new Date(new Date(sentAt).getTime() + DEDUP_WINDOW_MS);
}

// The poller's dedup memory is this log, so an entry stays until it can no longer block a repeat alert. The database
// enforces the same rule (policy "own old alerts deletable"); this only decides whether the page offers the button.
export function canDeleteAlert(sentAt: string, now: Date): boolean {
  return deletableAt(sentAt).getTime() <= now.getTime();
}

export function formatAlertTime(timestamp: string | Date): string {
  return DATE_TIME_FORMAT.format(new Date(timestamp));
}
