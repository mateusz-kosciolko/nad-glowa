// Shared by the settings endpoint and the settings island: no server-only imports here.

// Must match the constraints in supabase/migrations/20260928084032_alert_settings.sql.
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 100;
export const MAX_AIRCRAFT_TYPES = 20;
export const ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/;
// Telegram chat IDs fit in 52 bits (up to 16 digits); the parser also checks Number.isSafeInteger.
// The minus sign covers group chat IDs.
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,16}$/;

export interface AlertSettingsInput {
  home_lat: number | null;
  home_lon: number | null;
  radius_km: number;
  aircraft_types: string[];
  telegram_chat_id: number | null;
}

// Validation failures: the code goes into the redirect URL, the message is shown to the user. The settings page maps
// codes back to messages through src/lib/form-errors.ts, so a URL never carries free text.
export const VALIDATION_MESSAGES = {
  coords_pair: "Enter both latitude and longitude, or leave both empty",
  lat_range: "Latitude must be a number between -90 and 90",
  lon_range: "Longitude must be a number between -180 and 180",
  radius_required: "Radius is required",
  radius_range: `Radius must be a whole number between ${RADIUS_MIN} and ${RADIUS_MAX} km`,
  invalid_aircraft_type: "Invalid aircraft type code (use 2-4 letters or digits, e.g. B744)",
  too_many_types: `Enter at most ${MAX_AIRCRAFT_TYPES} aircraft types`,
  invalid_chat_id: "Telegram chat ID must be a whole number, e.g. 123456789",
  invalid_pause: "Invalid pause request",
} as const;

export type ValidationErrorCode = keyof typeof VALIDATION_MESSAGES;

function failure(code: ValidationErrorCode): { ok: false; code: ValidationErrorCode; error: string } {
  return { ok: false, code, error: VALIDATION_MESSAGES[code] };
}

export type AlertSettingsParseResult =
  { ok: true; value: AlertSettingsInput } | { ok: false; code: ValidationErrorCode; error: string };

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
      return failure("coords_pair");
    }
    home_lat = toNumber(rawLat);
    home_lon = toNumber(rawLon);
    if (!Number.isFinite(home_lat) || home_lat < -90 || home_lat > 90) {
      return failure("lat_range");
    }
    if (!Number.isFinite(home_lon) || home_lon < -180 || home_lon > 180) {
      return failure("lon_range");
    }
  }

  if (rawRadius === "") {
    return failure("radius_required");
  }
  const radius_km = toNumber(rawRadius);
  if (!Number.isInteger(radius_km) || radius_km < RADIUS_MIN || radius_km > RADIUS_MAX) {
    return failure("radius_range");
  }

  const aircraft_types = parseAircraftTypes(readField(form, "aircraft_types"));
  const invalidCode = aircraft_types.find((code) => !ICAO_TYPE_PATTERN.test(code));
  if (invalidCode !== undefined) {
    // The client-side message names the offending code; the URL carries only the code name.
    return {
      ok: false,
      code: "invalid_aircraft_type",
      error: `Invalid aircraft type code: ${invalidCode} (use 2-4 letters or digits, e.g. B744)`,
    };
  }
  if (aircraft_types.length > MAX_AIRCRAFT_TYPES) {
    return failure("too_many_types");
  }

  const rawChatId = readField(form, "telegram_chat_id");
  let telegram_chat_id: number | null = null;
  if (rawChatId !== "") {
    const chatId = Number(rawChatId);
    if (!TELEGRAM_CHAT_ID_PATTERN.test(rawChatId) || !Number.isSafeInteger(chatId)) {
      return failure("invalid_chat_id");
    }
    telegram_chat_id = chatId;
  }

  return { ok: true, value: { home_lat, home_lon, radius_km, aircraft_types, telegram_chat_id } };
}

export type PauseParseResult = { ok: true; paused: boolean } | { ok: false; code: ValidationErrorCode; error: string };

// An explicit target state, not a toggle: a double click or a resubmitted form cannot flip the state back.
export function parsePauseForm(form: FormData): PauseParseResult {
  const value = form.get("paused");
  if (value === "true") {
    return { ok: true, paused: true };
  }
  if (value === "false") {
    return { ok: true, paused: false };
  }
  return failure("invalid_pause");
}
