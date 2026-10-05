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
