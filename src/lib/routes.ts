// adsbdb client: the only place that knows the flight-route endpoint and its response format.
// Pure logic plus the global fetch, so no server-only imports here (unit-tested in Vitest).

const API_BASE = "https://api.adsbdb.com/v0/callsign";
const USER_AGENT = "nad-glowa (+https://nad-glowa.mateusz-kosciolko-321.workers.dev)";

// Real callsigns are short and alphanumeric; anything else is not worth a request (and "." or ".." would not even
// stay in the path after encoding).
const CALLSIGN_PATTERN = /^[A-Z0-9]{2,8}$/i;
// adsbdb text ends up in the alert message: cap it so odd data cannot bloat or break the message.
const MAX_CITY_CHARS = 60;
const MAX_CODE_CHARS = 4;

// Short on purpose: the route is a nice-to-have, and the alert waits for it.
export const ROUTE_LOOKUP_TIMEOUT_MS = 2000;

export interface RouteAirport {
  // IATA code, or ICAO when the airport has none.
  code: string;
  city: string | null;
}

export interface Route {
  origin: RouteAirport;
  destination: RouteAirport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// String with whitespace (including newlines) collapsed to single spaces, or null when missing or empty.
function readString(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed;
}

// An airport code is 3 (IATA) or 4 (ICAO) characters; a longer value is treated as missing.
function readCode(entry: Record<string, unknown>, key: string): string | null {
  const code = readString(entry, key);
  return code !== null && code.length <= MAX_CODE_CHARS ? code : null;
}

function parseAirport(entry: unknown): RouteAirport | null {
  if (!isRecord(entry)) {
    return null;
  }
  const code = readCode(entry, "iata_code") ?? readCode(entry, "icao_code");
  if (code === null) {
    return null;
  }
  const city = readString(entry, "municipality");
  return { code, city: city === null ? null : city.slice(0, MAX_CITY_CHARS) };
}

// Returns null for a miss (adsbdb answers `{"response":"unknown callsign"}`) and when either airport has no code.
export function parseRouteResponse(body: unknown): Route | null {
  if (!isRecord(body) || !isRecord(body.response)) {
    return null;
  }
  const flightroute = body.response.flightroute;
  if (!isRecord(flightroute)) {
    return null;
  }
  const origin = parseAirport(flightroute.origin);
  const destination = parseAirport(flightroute.destination);
  if (origin === null || destination === null) {
    return null;
  }
  return { origin, destination };
}

// Never throws: a malformed callsign (no request is made), a miss, a non-200 answer, a network error, a timeout
// and a malformed body all come back as null.
export async function lookupRoute(callsign: string): Promise<Route | null> {
  if (!CALLSIGN_PATTERN.test(callsign)) {
    return null;
  }
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(callsign)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(ROUTE_LOOKUP_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return null;
    }
    // A timeout can also fire while the body is still streaming; it lands in the same catch.
    const body: unknown = await response.json();
    return parseRouteResponse(body);
  } catch {
    return null;
  }
}

function formatAirport(airport: RouteAirport): string {
  return airport.city === null ? airport.code : `${airport.city} (${airport.code})`;
}

// Plain text, e.g. "Warsaw (WAW) → Chicago (ORD)".
export function formatRoute(route: Route): string {
  return `${formatAirport(route.origin)} → ${formatAirport(route.destination)}`;
}
