import { describe, expect, it } from "vitest";
import { parseAlertSettingsForm, parsePauseForm } from "@/lib/alert-settings";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("parsePauseForm", () => {
  it('pauses on "true"', () => {
    expect(parsePauseForm(form({ paused: "true" }))).toEqual({ ok: true, paused: true });
  });

  it('resumes on "false"', () => {
    expect(parsePauseForm(form({ paused: "false" }))).toEqual({ ok: true, paused: false });
  });

  it("rejects a missing field", () => {
    expect(parsePauseForm(form({}))).toEqual({ ok: false, code: "invalid_pause", error: "Invalid pause request" });
  });

  it("rejects other values", () => {
    expect(parsePauseForm(form({ paused: "yes" }))).toEqual({
      ok: false,
      code: "invalid_pause",
      error: "Invalid pause request",
    });
  });

  it("accepts only the exact lowercase values", () => {
    expect(parsePauseForm(form({ paused: "TRUE" }))).toEqual({
      ok: false,
      code: "invalid_pause",
      error: "Invalid pause request",
    });
  });
});

describe("parseAlertSettingsForm error codes", () => {
  const valid = { home_lat: "52.23", home_lon: "21.01", radius_km: "25", aircraft_types: "B744", telegram_chat_id: "" };

  function codeFor(fields: Record<string, string>): string | undefined {
    const result = parseAlertSettingsForm(form({ ...valid, ...fields }));
    return result.ok ? undefined : result.code;
  }

  it("accepts a valid form", () => {
    expect(parseAlertSettingsForm(form(valid)).ok).toBe(true);
  });

  it.each([
    [{ home_lon: "" }, "coords_pair"],
    [{ home_lat: "91" }, "lat_range"],
    [{ home_lon: "-181" }, "lon_range"],
    [{ radius_km: "" }, "radius_required"],
    [{ radius_km: "0" }, "radius_range"],
    [{ aircraft_types: "B7444X" }, "invalid_aircraft_type"],
    [{ aircraft_types: Array.from({ length: 21 }, (_, i) => `A${String(i + 10)}`).join(",") }, "too_many_types"],
    [{ telegram_chat_id: "abc" }, "invalid_chat_id"],
  ])("rejects %j with code %s", (fields, code) => {
    expect(codeFor(fields)).toBe(code);
  });

  it("keeps the offending aircraft code in the client-side message", () => {
    const result = parseAlertSettingsForm(form({ ...valid, aircraft_types: "B7444X" }));
    expect(result.ok ? null : result.error).toContain("B7444X");
  });
});
