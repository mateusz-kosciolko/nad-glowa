import { describe, expect, it } from "vitest";
import type { AircraftState } from "@/lib/adsb";
import { predictPass, queryRadiusKm } from "@/lib/flyover";

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
// 360 kt is exactly 0.1852 km/s.
const SPEED_KT = 360;
const SPEED_KM_S = (SPEED_KT * 1.852) / 3600;

// Home on the equator keeps the flat-frame conversion free of cos(lat) rounding.
const HOME = { lat: 0, lon: 0 };
const WARSAW = { lat: 52.23, lon: 21.01 };

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    hex: "48af01",
    type: "B744",
    registration: "SP-LRA",
    callsign: "LOT1",
    lat: 0,
    lon: 0,
    trackDeg: 180,
    groundSpeedKt: SPEED_KT,
    onGround: false,
    military: false,
    positionAgeS: 0,
    ...overrides,
  };
}

// Due south/north by D km along a meridian: a great-circle arc, so dLat = D / R radians (no cos involved).
function kmToLatDeg(km: number): number {
  return km / EARTH_RADIUS_KM / DEG_TO_RAD;
}

// Due north of HOME, flying straight south over it, `seconds` before the overhead pass.
function inboundFromNorth(seconds: number, overrides: Partial<AircraftState> = {}): AircraftState {
  return aircraft({ lat: kmToLatDeg(seconds * SPEED_KM_S), ...overrides });
}

// The adjacent double towards +/-Infinity (positive values only).
function nextDouble(value: number, direction: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction));
  return view.getFloat64(0);
}

// An inbound aircraft whose computed lead time is exactly `seconds`. The degree/km round trip alone can land a hair
// off (e.g. 119.99999999999999 at 360 kt), which would make a boundary test meaningless, so try nearby speeds and
// latitudes a few ulps apart until the computation hits the boundary exactly.
function inboundExactly(seconds: number): AircraftState {
  for (let speedKt = SPEED_KT; speedKt < SPEED_KT + 50; speedKt++) {
    const baseLat = kmToLatDeg((seconds * speedKt * 1.852) / 3600);
    let up = baseLat;
    let down = baseLat;
    for (let step = 0; step < 8; step++) {
      for (const lat of [up, down]) {
        const candidate = aircraft({ lat, groundSpeedKt: speedKt });
        if (predictPass(candidate, HOME, 10)?.secondsToClosest === seconds) {
          return candidate;
        }
      }
      up = nextDouble(up, 1);
      down = nextDouble(down, -1);
    }
  }
  throw new Error(`No inbound fixture gives exactly ${seconds} s`);
}

describe("predictPass", () => {
  it("alerts an aircraft heading straight for home 10 min out", () => {
    const prediction = predictPass(inboundFromNorth(600), HOME, 10);
    expect(prediction).not.toBeNull();
    expect(prediction?.secondsToClosest).toBeCloseTo(600, 6);
    expect(prediction?.closestDistanceKm).toBeCloseTo(0, 6);
    expect(prediction?.alreadyClose).toBe(false);
    expect(prediction?.approachFrom).toBe("N");
  });

  describe("radius boundary", () => {
    // Passes 12 km east of home, 5 min from the closest point.
    const passer = aircraft({ lat: kmToLatDeg(300 * SPEED_KM_S), lon: kmToLatDeg(12) });
    const reference = predictPass(passer, HOME, 100);

    it("alerts when the closest distance equals the radius", () => {
      expect(reference).not.toBeNull();
      const closest = reference?.closestDistanceKm ?? Number.NaN;
      expect(closest).toBeCloseTo(12, 6);
      expect(predictPass(passer, HOME, closest)).not.toBeNull();
    });

    it("does not alert just beyond the radius", () => {
      const closest = reference?.closestDistanceKm ?? Number.NaN;
      expect(predictPass(passer, HOME, closest - 0.001)).toBeNull();
    });
  });

  describe("lead time boundaries", () => {
    it("alerts at 900 s to the closest point", () => {
      const prediction = predictPass(inboundExactly(900), HOME, 10);
      expect(prediction).not.toBeNull();
      expect(prediction?.secondsToClosest).toBe(900);
    });

    it("does not alert at 901 s", () => {
      expect(predictPass(inboundFromNorth(901), HOME, 10)).toBeNull();
    });

    it("treats 120 s as a regular alert", () => {
      const prediction = predictPass(inboundExactly(120), HOME, 10);
      expect(prediction?.secondsToClosest).toBe(120);
      expect(prediction?.alreadyClose).toBe(false);
    });

    it("treats 119 s as already close", () => {
      const prediction = predictPass(inboundFromNorth(119), HOME, 10);
      expect(prediction?.secondsToClosest).toBeCloseTo(119, 6);
      expect(prediction?.alreadyClose).toBe(true);
    });
  });

  it("flags a receding aircraft inside the radius as already close, closest point now", () => {
    const prediction = predictPass(inboundFromNorth(20, { trackDeg: 0 }), HOME, 10);
    expect(prediction).not.toBeNull();
    expect(prediction?.secondsToClosest).toBe(0);
    expect(prediction?.closestDistanceKm).toBeCloseTo(20 * SPEED_KM_S, 6);
    expect(prediction?.alreadyClose).toBe(true);
  });

  it("ignores a receding aircraft outside the radius", () => {
    expect(predictPass(inboundFromNorth(300, { trackDeg: 0 }), HOME, 10)).toBeNull();
  });

  it.each<[string, Partial<AircraftState>]>([
    ["on the ground", { onGround: true }],
    ["without a track", { trackDeg: null }],
    ["without a ground speed", { groundSpeedKt: null }],
    ["with a 61 s old position", { positionAgeS: 61 }],
  ])("ignores an aircraft %s", (_label, overrides) => {
    expect(predictPass(inboundFromNorth(600, overrides), HOME, 10)).toBeNull();
  });

  it("treats a missing position age as fresh", () => {
    expect(predictPass(inboundFromNorth(600, { positionAgeS: null }), HOME, 10)?.secondsToClosest).toBeCloseTo(600, 6);
  });

  it("moves the position forward by its age", () => {
    const fresh = predictPass(inboundFromNorth(600), HOME, 10);
    const aged = predictPass(inboundFromNorth(600, { positionAgeS: 30 }), HOME, 10);
    expect(fresh).not.toBeNull();
    expect(aged).not.toBeNull();
    expect((fresh?.secondsToClosest ?? 0) - (aged?.secondsToClosest ?? 0)).toBeCloseTo(30, 6);
  });

  it("flags a stationary aircraft inside the radius as already close", () => {
    const prediction = predictPass(inboundFromNorth(20, { groundSpeedKt: 0 }), HOME, 10);
    expect(prediction).not.toBeNull();
    expect(prediction?.secondsToClosest).toBe(0);
    expect(prediction?.alreadyClose).toBe(true);
  });

  it("reports the approach direction of an aircraft north-west of home", () => {
    const prediction = predictPass(
      aircraft({ lat: WARSAW.lat + 0.1, lon: WARSAW.lon - 0.1, trackDeg: 148 }),
      WARSAW,
      20,
    );
    expect(prediction).not.toBeNull();
    expect(prediction?.approachFrom).toBe("NW");
  });
});

describe("queryRadiusKm", () => {
  it("adds the look-ahead distance to the user's radius", () => {
    // 30 + 600 kt * 1.852 * 900 s / 3600 = 30 + 277.8
    expect(queryRadiusKm(30)).toBeCloseTo(307.8, 6);
  });
});

// Boundary table at a realistic latitude: at 52.23 N a missing or doubled cos(lat) in the east-west conversion
// moves a 9.8 km pass to ~16 km (missed) or a 10.2 km pass to ~6.2 km (false alert). Every expected value below
// comes from the fixture geometry and the PRD, never from predictPass output.
describe("predictPass at Warsaw", () => {
  const RADIUS_KM = 10;
  // Closest approach 5 min ahead: the aircraft starts 300 s * 0.1852 km/s = 55.56 km due south of home's parallel.
  const PASS_LEAD_S = 300;

  // East/west offset whose great-circle distance from home, measured along home's parallel, is X km.
  // Haversine with dLat = 0: sin^2(X / 2R) = cos^2(lat) * sin^2(dLon / 2), so dLon = 2 * asin(sin(X / 2R) / cos(lat)).
  // This inverts spherical haversine, not the flat-frame formula predictPass uses.
  function warsawLonOffsetDeg(km: number): number {
    const latRad = WARSAW.lat * DEG_TO_RAD;
    return (2 * Math.asin(Math.sin(km / (2 * EARTH_RADIUS_KM)) / Math.cos(latRad))) / DEG_TO_RAD;
  }

  // South of home, flying due north (track 0), offset X km east (+1) or west (-1). The track is a meridian, so the
  // closest point lies on home's parallel, X km from home, PASS_LEAD_S from now.
  function northboundPasser(offsetKm: number, side: 1 | -1): AircraftState {
    return aircraft({
      lat: WARSAW.lat - kmToLatDeg(PASS_LEAD_S * SPEED_KM_S),
      lon: WARSAW.lon + side * warsawLonOffsetDeg(offsetKm),
      trackDeg: 0,
    });
  }

  // Due north of home, flying straight south over it, `seconds` before the overhead pass.
  function inboundOverWarsaw(seconds: number, overrides: Partial<AircraftState> = {}): AircraftState {
    return aircraft({
      lat: WARSAW.lat + kmToLatDeg(seconds * SPEED_KM_S),
      lon: WARSAW.lon,
      trackDeg: 180,
      ...overrides,
    });
  }

  it.each<[string, 1 | -1]>([
    ["east", 1],
    ["west", -1],
  ])("alerts a pass 9.8 km %s of home, 5 min ahead", (_label, side) => {
    const prediction = predictPass(northboundPasser(9.8, side), WARSAW, RADIUS_KM);
    expect(prediction).not.toBeNull();
    expect(Math.abs((prediction?.closestDistanceKm ?? Number.NaN) - 9.8)).toBeLessThanOrEqual(0.05);
    expect(Math.abs((prediction?.secondsToClosest ?? Number.NaN) - PASS_LEAD_S)).toBeLessThanOrEqual(1);
    expect(prediction?.alreadyClose).toBe(false);
  });

  it.each<[string, 1 | -1]>([
    ["east", 1],
    ["west", -1],
  ])("does not alert a pass 10.2 km %s of home (outside the radius)", (_label, side) => {
    expect(predictPass(northboundPasser(10.2, side), WARSAW, RADIUS_KM)).toBeNull();
  });

  it("alerts a pass 1 min ahead and marks it already close", () => {
    const prediction = predictPass(inboundOverWarsaw(60), WARSAW, RADIUS_KM);
    expect(prediction).not.toBeNull();
    expect(prediction?.alreadyClose).toBe(true);
  });

  it("alerts a pass 14 min ahead as a regular alert", () => {
    const prediction = predictPass(inboundOverWarsaw(14 * 60), WARSAW, RADIUS_KM);
    expect(prediction).not.toBeNull();
    expect(prediction?.alreadyClose).toBe(false);
  });

  it("does not alert a pass 16 min ahead (beyond the 15 min horizon)", () => {
    expect(predictPass(inboundOverWarsaw(16 * 60), WARSAW, RADIUS_KM)).toBeNull();
  });

  it("ignores an aircraft on the ground 10 min out", () => {
    expect(predictPass(inboundOverWarsaw(10 * 60, { onGround: true }), WARSAW, RADIUS_KM)).toBeNull();
  });
});
