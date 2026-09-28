// Shared by the settings endpoint and the settings island: no server-only imports here.

// Must match the constraints in supabase/migrations/20260928084032_alert_settings.sql.
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 100;
export const MAX_AIRCRAFT_TYPES = 20;
export const ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/;

export interface AlertSettingsInput {
  home_lat: number | null;
  home_lon: number | null;
  radius_km: number;
  aircraft_types: string[];
}

export type AlertSettingsParseResult = { ok: true; value: AlertSettingsInput } | { ok: false; error: string };

export function parseAircraftTypes(raw: string): string[] {
  const codes = raw
    .split(/[,;\s]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== "");
  return [...new Set(codes)];
}

function readField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// Accepts the Polish decimal comma ("52,23"); callers treat an empty string as a missing value,
// because Number("") would silently become 0.
function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

export function parseAlertSettingsForm(form: FormData): AlertSettingsParseResult {
  const rawLat = readField(form, "home_lat");
  const rawLon = readField(form, "home_lon");
  const rawRadius = readField(form, "radius_km");

  let home_lat: number | null = null;
  let home_lon: number | null = null;
  if (rawLat !== "" || rawLon !== "") {
    if (rawLat === "" || rawLon === "") {
      return { ok: false, error: "Enter both latitude and longitude, or leave both empty" };
    }
    home_lat = toNumber(rawLat);
    home_lon = toNumber(rawLon);
    if (!Number.isFinite(home_lat) || home_lat < -90 || home_lat > 90) {
      return { ok: false, error: "Latitude must be a number between -90 and 90" };
    }
    if (!Number.isFinite(home_lon) || home_lon < -180 || home_lon > 180) {
      return { ok: false, error: "Longitude must be a number between -180 and 180" };
    }
  }

  if (rawRadius === "") {
    return { ok: false, error: "Radius is required" };
  }
  const radius_km = toNumber(rawRadius);
  if (!Number.isInteger(radius_km) || radius_km < RADIUS_MIN || radius_km > RADIUS_MAX) {
    return { ok: false, error: `Radius must be a whole number between ${RADIUS_MIN} and ${RADIUS_MAX} km` };
  }

  const aircraft_types = parseAircraftTypes(readField(form, "aircraft_types"));
  const invalidCode = aircraft_types.find((code) => !ICAO_TYPE_PATTERN.test(code));
  if (invalidCode !== undefined) {
    return {
      ok: false,
      error: `Invalid aircraft type code: ${invalidCode} (use 2-4 letters or digits, e.g. B744)`,
    };
  }
  if (aircraft_types.length > MAX_AIRCRAFT_TYPES) {
    return { ok: false, error: `Enter at most ${MAX_AIRCRAFT_TYPES} aircraft types` };
  }

  return { ok: true, value: { home_lat, home_lon, radius_km, aircraft_types } };
}
