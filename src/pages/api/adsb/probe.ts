import type { APIRoute } from "astro";
import { ADSB_SOURCES, DEFAULT_ADSB_SOURCE, fetchAircraftNear, summarizeAircraft, type AdsbSourceId } from "@/lib/adsb";
import { createClient } from "@/lib/supabase";

// Diagnostic endpoint: checks that an ADS-B source answers for the signed-in user's area (from any environment,
// including production on Cloudflare IPs). Replies with JSON, never with home or aircraft coordinates.

const SAMPLE_SIZE = 5;
const NO_HOME_ERROR = "Set your home location in /settings first";

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isAdsbSourceId(value: string): value is AdsbSourceId {
  return Object.keys(ADSB_SOURCES).includes(value);
}

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(503, { error: "Supabase is not configured" });
  }

  const rawSource = context.url.searchParams.get("source");
  let source: AdsbSourceId = DEFAULT_ADSB_SOURCE;
  if (rawSource !== null) {
    if (!isAdsbSourceId(rawSource)) {
      return json(400, { error: `Unknown source (use one of: ${Object.keys(ADSB_SOURCES).join(", ")})` });
    }
    source = rawSource;
  }

  const { data, error } = await supabase
    .from("alert_settings")
    .select("home_lat, home_lon, radius_km")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return json(500, { error: error.message });
  }
  // No row (the signup trigger failed) or no home location yet: nothing to probe around.
  if (!data) {
    return json(409, { error: NO_HOME_ERROR });
  }
  const { home_lat: lat, home_lon: lon, radius_km: radiusKm } = data;
  if (lat === null || lon === null) {
    return json(409, { error: NO_HOME_ERROR });
  }

  const result = await fetchAircraftNear({ lat, lon, radiusKm }, source);
  if (!result.ok) {
    const { ok, httpStatus, durationMs, error: fetchError, upstream } = result;
    return json(502, { source, ok, httpStatus, durationMs, error: fetchError, upstream });
  }

  const { ok, httpStatus, durationMs, skipped, aircraft } = result;
  const sample = aircraft
    .slice(0, SAMPLE_SIZE)
    .map(({ hex, type, registration, callsign, military }) => ({ hex, type, registration, callsign, military }));
  return json(200, { source, ok, httpStatus, durationMs, radiusKm, skipped, ...summarizeAircraft(aircraft), sample });
};
