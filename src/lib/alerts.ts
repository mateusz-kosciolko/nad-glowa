// Alert rules shared by the poller: duplicate detection and message text. Pure logic, no server-only imports.
import type { AircraftState } from "@/lib/adsb";
import type { PassPrediction } from "@/lib/flyover";
import { formatRoute, type Route } from "@/lib/routes";

// The same aircraft is alerted at most once per window.
export const DEDUP_WINDOW_MS = 60 * 60_000;

// Alert times are shown in the users' local time.
export const ALERT_TIME_ZONE = "Europe/Warsaw";

// en-GB with hour12 false gives "00:05", never "24:05".
const CLOCK_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ALERT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Same machine means the same transponder address or the same registration, whatever the callsign.
// `~` addresses are not stable enough to match on; an entry exactly DEDUP_WINDOW_MS old no longer blocks.
export function isRecentlyAlerted(
  aircraft: { hex: string; registration: string | null },
  recent: readonly { aircraft_hex: string; registration: string | null; sent_at: string }[],
  now: Date,
): boolean {
  const hexIsStable = !aircraft.hex.startsWith("~");
  return recent.some((entry) => {
    if (now.getTime() - new Date(entry.sent_at).getTime() >= DEDUP_WINDOW_MS) {
      return false;
    }
    const sameHex = hexIsStable && entry.aircraft_hex === aircraft.hex;
    const sameRegistration =
      aircraft.registration !== null && aircraft.registration !== "" && entry.registration === aircraft.registration;
    return sameHex || sameRegistration;
  });
}

// Plain text (sent without parse_mode, so nothing needs escaping). The adsb.fi link and credit are required
// attribution; adsbdb is credited too whenever the route line comes from it.
export function formatAlertMessage(
  aircraft: AircraftState,
  prediction: PassPrediction,
  route: Route | null,
  now: Date,
): string {
  // The poller matches on type, so a null type never reaches here; the fallback only satisfies the type.
  const header = `${aircraft.type ?? "Unknown type"} · ${aircraft.registration ?? "registration unknown"}`;
  let timing: string;
  if (prediction.alreadyClose) {
    timing = "ALREADY CLOSE";
  } else {
    const minutes = Math.round(prediction.secondsToClosest / 60);
    const clock = CLOCK_FORMAT.format(new Date(now.getTime() + prediction.secondsToClosest * 1000));
    timing = `Overhead in ~${minutes} min (${clock})`;
  }
  return [
    header,
    timing,
    `Approaching from ${prediction.approachFrom}, closest pass ${prediction.closestDistanceKm.toFixed(1)} km`,
    route === null ? "Route unknown" : `Route: ${formatRoute(route)}`,
    `https://globe.adsb.fi/?icao=${aircraft.hex}`,
    route === null ? "Data: adsb.fi" : "Data: adsb.fi, adsbdb",
  ].join("\n");
}
