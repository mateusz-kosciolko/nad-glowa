import { describe, expect, it } from "vitest";
import type { AircraftState } from "@/lib/adsb";
import { formatAlertMessage, isRecentlyAlerted } from "@/lib/alerts";
import type { PassPrediction } from "@/lib/flyover";

// 12:00 UTC in July is 14:00 in Warsaw (CEST).
const NOW = new Date("2026-07-15T12:00:00Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    hex: "48af01",
    type: "B744",
    registration: "SP-LRA",
    callsign: "LOT1",
    lat: 52.3,
    lon: 21,
    trackDeg: 180,
    groundSpeedKt: 360,
    onGround: false,
    military: false,
    positionAgeS: 0,
    ...overrides,
  };
}

function prediction(overrides: Partial<PassPrediction> = {}): PassPrediction {
  return { secondsToClosest: 420, closestDistanceKm: 3.14, alreadyClose: false, approachFrom: "NW", ...overrides };
}

describe("isRecentlyAlerted", () => {
  it("matches the same transponder address", () => {
    const recent = [{ aircraft_hex: "48af01", registration: null, sent_at: minutesAgo(10) }];
    expect(isRecentlyAlerted({ hex: "48af01", registration: null }, recent, NOW)).toBe(true);
  });

  it("matches the same registration under a different address", () => {
    const recent = [{ aircraft_hex: "48af99", registration: "SP-LRA", sent_at: minutesAgo(10) }];
    expect(isRecentlyAlerted({ hex: "48af01", registration: "SP-LRA" }, recent, NOW)).toBe(true);
  });

  it("does not match a ~ address without a registration", () => {
    const recent = [{ aircraft_hex: "~1a2b3c", registration: null, sent_at: minutesAgo(10) }];
    expect(isRecentlyAlerted({ hex: "~1a2b3c", registration: null }, recent, NOW)).toBe(false);
  });

  it("is blocked by an alert sent 59 min ago", () => {
    const recent = [{ aircraft_hex: "48af01", registration: "SP-LRA", sent_at: minutesAgo(59) }];
    expect(isRecentlyAlerted({ hex: "48af01", registration: "SP-LRA" }, recent, NOW)).toBe(true);
  });

  it("is not blocked by an alert sent exactly 60 min ago", () => {
    const recent = [{ aircraft_hex: "48af01", registration: "SP-LRA", sent_at: minutesAgo(60) }];
    expect(isRecentlyAlerted({ hex: "48af01", registration: "SP-LRA" }, recent, NOW)).toBe(false);
  });
});

describe("formatAlertMessage", () => {
  it("describes a regular alert", () => {
    const message = formatAlertMessage(aircraft(), prediction(), NOW);
    expect(message).toContain("B744");
    expect(message).toContain("SP-LRA");
    expect(message).toContain("~7 min");
    // 12:07 UTC is 14:07 in Warsaw.
    expect(message).toContain("(14:07)");
    expect(message).toContain("Approaching from NW");
    expect(message).toContain("3.1 km");
    expect(message).toContain("Route unknown");
    expect(message).toContain("https://globe.adsb.fi/?icao=48af01");
    expect(message).toContain("Data: adsb.fi");
    expect(message).not.toContain("ALREADY CLOSE");
  });

  it("says when the registration is unknown", () => {
    const message = formatAlertMessage(aircraft({ registration: null }), prediction(), NOW);
    expect(message).toContain("registration unknown");
  });

  it("replaces the lead time with ALREADY CLOSE", () => {
    const message = formatAlertMessage(aircraft(), prediction({ secondsToClosest: 60, alreadyClose: true }), NOW);
    expect(message).toContain("ALREADY CLOSE");
    expect(message).not.toContain("Overhead in");
    expect(message).not.toContain("min (");
  });
});
