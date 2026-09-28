// ADS-B source client: the only place that knows the feeds' endpoints, units and response format.
// Pure logic plus the global fetch, so no server-only imports here (the layout imports ADSB_SOURCES).
import { ICAO_TYPE_PATTERN } from "@/lib/alert-settings";

export type AdsbSourceId = "adsb.fi" | "adsb.lol";

export const DEFAULT_ADSB_SOURCE: AdsbSourceId = "adsb.fi";

// Both APIs take the radius in nautical miles.
export const ADSB_SOURCES: Record<
  AdsbSourceId,
  { label: string; homepage: string; pointUrl(lat: number, lon: number, radiusNm: number): string }
> = {
  "adsb.fi": {
    label: "adsb.fi",
    homepage: "https://adsb.fi",
    pointUrl: (lat, lon, radiusNm) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radiusNm}`,
  },
  "adsb.lol": {
    label: "adsb.lol",
    homepage: "https://adsb.lol",
    pointUrl: (lat, lon, radiusNm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`,
  },
};

const USER_AGENT = "nad-glowa (+https://nad-glowa.mateusz-kosciolko-321.workers.dev)";
const TIMEOUT_MS = 10_000;
const MAX_RADIUS_NM = 250;

export interface AircraftState {
  // Lowercase, as reported: an ICAO 24-bit address, or a `~`-prefixed non-ICAO (TIS-B) one that is not stable enough
  // to deduplicate alerts on.
  hex: string;
  type: string | null;
  registration: string | null;
  callsign: string | null;
  lat: number;
  lon: number;
  trackDeg: number | null;
  groundSpeedKt: number | null;
  onGround: boolean;
  military: boolean;
  positionAgeS: number | null;
}

export type AdsbFetchResult =
  | {
      ok: true;
      source: AdsbSourceId;
      httpStatus: number;
      durationMs: number;
      aircraft: AircraftState[];
      skipped: number;
    }
  | {
      ok: false;
      source: AdsbSourceId;
      httpStatus: number | null;
      durationMs: number;
      error: string;
      // Only for non-2xx answers: enough to tell a deliberate block (e.g. an edge rule) from a rate limit.
      upstream?: UpstreamDiagnostics;
    };

export interface UpstreamDiagnostics {
  server: string | null;
  cfRay: string | null;
  retryAfter: string | null;
  bodyStart: string;
}

const DIAGNOSTIC_BODY_CHARS = 200;

export interface AircraftSummary {
  total: number;
  airborne: number;
  withType: number;
  typeMatchesPattern: number;
  withRegistration: number;
  withCallsign: number;
  withTrackAndSpeed: number;
  military: number;
  maxPositionAgeS: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Trimmed string, or null when missing or empty.
function readString(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readNumber(entry: Record<string, unknown>, key: string): number | null {
  const value = entry[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseAircraft(entry: unknown): AircraftState | null {
  if (!isRecord(entry)) {
    return null;
  }
  const hex = readString(entry, "hex");
  const lat = readNumber(entry, "lat");
  const lon = readNumber(entry, "lon");
  if (hex === null || lat === null || lon === null) {
    return null;
  }
  const dbFlags = readNumber(entry, "dbFlags");
  return {
    hex: hex.toLowerCase(),
    type: readString(entry, "t")?.toUpperCase() ?? null,
    registration: readString(entry, "r"),
    callsign: readString(entry, "flight"),
    lat,
    lon,
    trackDeg: readNumber(entry, "track"),
    groundSpeedKt: readNumber(entry, "gs"),
    // alt_baro is a number in flight and the string "ground" on the ground.
    onGround: entry.alt_baro === "ground",
    military: dbFlags !== null && (dbFlags & 1) === 1,
    positionAgeS: readNumber(entry, "seen_pos"),
  };
}

// Returns null when the body has no `ac` array; entries without a hex or a numeric position are counted as skipped.
export function parseAdsbResponse(body: unknown): { aircraft: AircraftState[]; skipped: number } | null {
  if (!isRecord(body)) {
    return null;
  }
  const entries: unknown = body.ac;
  if (!Array.isArray(entries)) {
    return null;
  }
  const aircraft: AircraftState[] = [];
  let skipped = 0;
  for (const entry of entries as unknown[]) {
    const parsed = parseAircraft(entry);
    if (parsed) {
      aircraft.push(parsed);
    } else {
      skipped++;
    }
  }
  return { aircraft, skipped };
}

// Round up so the circle never shrinks below the user's radius; cap at the APIs' maximum.
function kmToNm(radiusKm: number): number {
  return Math.min(MAX_RADIUS_NM, Math.ceil(radiusKm / 1.852));
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `No response within ${TIMEOUT_MS / 1000} s`;
  }
  return `Network error: ${error instanceof Error ? error.message : String(error)}`;
}

// Never throws: every failure comes back as `ok: false` with a readable error.
export async function fetchAircraftNear(
  query: { lat: number; lon: number; radiusKm: number },
  source: AdsbSourceId = DEFAULT_ADSB_SOURCE,
): Promise<AdsbFetchResult> {
  const url = ADSB_SOURCES[source].pointUrl(query.lat, query.lon, kmToNm(query.radiusKm));
  const startedAt = Date.now();
  const failure = (httpStatus: number | null, error: string, upstream?: UpstreamDiagnostics): AdsbFetchResult => ({
    ok: false,
    source,
    httpStatus,
    durationMs: Date.now() - startedAt,
    error,
    ...(upstream && { upstream }),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return failure(null, describeFetchError(error));
  }

  if (!response.ok) {
    let bodyStart = "";
    try {
      bodyStart = (await response.text()).slice(0, DIAGNOSTIC_BODY_CHARS);
    } catch {
      // The status alone is still worth reporting.
    }
    return failure(response.status, `${source} responded with HTTP ${response.status}`, {
      server: response.headers.get("server"),
      cfRay: response.headers.get("cf-ray"),
      retryAfter: response.headers.get("retry-after"),
      bodyStart,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A timeout can also fire while the body is still streaming.
    if (error instanceof Error && error.name === "TimeoutError") {
      return failure(response.status, describeFetchError(error));
    }
    return failure(response.status, `${source} returned a body that is not valid JSON`);
  }

  const parsed = parseAdsbResponse(body);
  if (!parsed) {
    return failure(response.status, `${source} returned JSON without an "ac" array`);
  }

  return {
    ok: true,
    source,
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
    aircraft: parsed.aircraft,
    skipped: parsed.skipped,
  };
}

// Counts only, no coordinates, so the result is safe to return from diagnostics.
export function summarizeAircraft(aircraft: AircraftState[]): AircraftSummary {
  const summary: AircraftSummary = {
    total: aircraft.length,
    airborne: 0,
    withType: 0,
    typeMatchesPattern: 0,
    withRegistration: 0,
    withCallsign: 0,
    withTrackAndSpeed: 0,
    military: 0,
    maxPositionAgeS: null,
  };
  for (const plane of aircraft) {
    if (!plane.onGround) summary.airborne++;
    if (plane.type !== null) summary.withType++;
    if (plane.type !== null && ICAO_TYPE_PATTERN.test(plane.type)) summary.typeMatchesPattern++;
    if (plane.registration !== null) summary.withRegistration++;
    if (plane.callsign !== null) summary.withCallsign++;
    if (plane.trackDeg !== null && plane.groundSpeedKt !== null) summary.withTrackAndSpeed++;
    if (plane.military) summary.military++;
    if (plane.positionAgeS !== null) {
      summary.maxPositionAgeS = Math.max(summary.maxPositionAgeS ?? 0, plane.positionAgeS);
    }
  }
  return summary;
}
