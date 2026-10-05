// One alert run for every active user: fetch nearby aircraft, predict passes, skip duplicates, send, record.
// Gets the service_role client from the scheduled handler as a parameter, so this module never imports it.
// Error strings end up in cron_runs.error and the log: they name users only by their position in this run
// and never carry home coordinates, chat IDs or the bot token.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TELEGRAM_BOT_TOKEN } from "astro:env/server";
import type { Database } from "@/db/database.types";
import { fetchAircraftNear, type AircraftState } from "@/lib/adsb";
import { DEDUP_WINDOW_MS, formatAlertMessage, isRecentlyAlerted } from "@/lib/alerts";
import { predictPass, queryRadiusKm, type PassPrediction } from "@/lib/flyover";
import { sendTelegramMessage } from "@/lib/telegram";

// adsb.fi allows about one request per second per IP; keep a margin.
export const ADSB_REQUEST_GAP_MS = 1100;

export interface AlertPollSummary {
  users: number;
  polled: number;
  matches: number;
  duplicates: number;
  sent: number;
  errors: string[];
}

interface RecentAlert {
  aircraft_hex: string;
  registration: string | null;
  sent_at: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One decimal place, as stored in numeric(6,1).
function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export async function runAlertPoll(supabase: SupabaseClient<Database>, now: () => Date): Promise<AlertPollSummary> {
  const summary: AlertPollSummary = { users: 0, polled: 0, matches: 0, duplicates: 0, sent: 0, errors: [] };

  const token = TELEGRAM_BOT_TOKEN;
  if (!token) {
    summary.errors.push("TELEGRAM_BOT_TOKEN is not configured; no alerts can be sent");
    return summary;
  }

  const { data: settings, error: settingsError } = await supabase
    .from("alert_settings")
    .select("user_id, home_lat, home_lon, radius_km, aircraft_types, telegram_chat_id")
    .eq("paused", false)
    .not("home_lat", "is", null)
    .not("home_lon", "is", null)
    .not("telegram_chat_id", "is", null)
    .order("user_id");
  if (settingsError) {
    summary.errors.push(`reading alert settings failed: ${settingsError.message}`);
    return summary;
  }

  const users = settings.flatMap((row) => {
    const types = new Set(row.aircraft_types.filter((code): code is string => typeof code === "string"));
    // Users without any type would never match; the query already excludes missing home and chat ID.
    if (types.size === 0) {
      return [];
    }
    return [
      {
        userId: row.user_id,
        home: { lat: row.home_lat, lon: row.home_lon },
        radiusKm: row.radius_km,
        types,
        chatId: row.telegram_chat_id,
      },
    ];
  });
  summary.users = users.length;

  let lastRequestAt: number | null = null;
  for (const [index, user] of users.entries()) {
    const fail = (reason: string) => summary.errors.push(`user ${index + 1}: ${reason}`);

    // Space requests, but never delay the first one.
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + ADSB_REQUEST_GAP_MS - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
    }
    lastRequestAt = Date.now();
    const result = await fetchAircraftNear({ ...user.home, radiusKm: queryRadiusKm(user.radiusKm) });
    if (!result.ok) {
      // A 4xx (rate limit or block) means more requests from this IP would only make it worse.
      if (result.httpStatus !== null && result.httpStatus >= 400 && result.httpStatus < 500) {
        fail(`${result.error}; ADS-B polling stopped for the remaining users in this run`);
        break;
      }
      fail(result.error);
      continue;
    }
    summary.polled++;

    const at = now();
    const candidates: { aircraft: AircraftState; prediction: PassPrediction }[] = [];
    for (const aircraft of result.aircraft) {
      if (aircraft.type === null || !user.types.has(aircraft.type)) {
        continue;
      }
      const prediction = predictPass(aircraft, user.home, user.radiusKm);
      if (prediction) {
        candidates.push({ aircraft, prediction });
      }
    }
    summary.matches += candidates.length;
    if (candidates.length === 0) {
      continue;
    }

    const { data: recentRows, error: recentError } = await supabase
      .from("alert_notifications")
      .select("aircraft_hex, registration, sent_at")
      .eq("user_id", user.userId)
      .gte("sent_at", new Date(at.getTime() - DEDUP_WINDOW_MS).toISOString());
    if (recentError) {
      // Sending without the dedup memory could repeat alerts every minute; skip this user instead.
      fail(`reading recent alerts failed: ${recentError.message}`);
      continue;
    }
    const recent: RecentAlert[] = [...recentRows];

    for (const { aircraft, prediction } of candidates) {
      if (isRecentlyAlerted(aircraft, recent, at)) {
        summary.duplicates++;
        continue;
      }

      // Send first, record second: a failed send leaves no row, so the next run retries it.
      const sendResult = await sendTelegramMessage({
        token,
        chatId: user.chatId,
        text: formatAlertMessage(aircraft, prediction, at),
      });
      if (!sendResult.ok) {
        fail(`Telegram send failed: ${sendResult.error}`);
        continue;
      }
      summary.sent++;

      // Remembered even if the insert fails, so a second entry for the same machine in this response is skipped.
      // sent_at in the table is the database's now(), i.e. the moment after the send.
      recent.push({ aircraft_hex: aircraft.hex, registration: aircraft.registration, sent_at: at.toISOString() });
      const { error: insertError } = await supabase.from("alert_notifications").insert({
        user_id: user.userId,
        aircraft_hex: aircraft.hex,
        registration: aircraft.registration,
        // Candidates match on type, so it is never null here.
        aircraft_type: aircraft.type ?? "",
        closest_at: new Date(at.getTime() + prediction.secondsToClosest * 1000).toISOString(),
        closest_distance_km: roundKm(prediction.closestDistanceKm),
        already_close: prediction.alreadyClose,
      });
      if (insertError) {
        fail(`alert sent but not recorded (may repeat next run): ${insertError.message}`);
      }
    }
  }

  return summary;
}
