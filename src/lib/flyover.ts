// Fly-over prediction: the one place for the "passes within the radius in 2-15 min" rule.
// Straight-line extrapolation at the current track and speed. Pure logic, no server-only imports.
import type { AircraftState } from "@/lib/adsb";

// An alert gives at least LEAD_MIN_S of warning; anything sooner is flagged as already close.
export const LEAD_MIN_S = 120;
// Passes further out than this are not alerted yet; a later poll will catch them.
export const LEAD_MAX_S = 900;
// Older positions are too stale to extrapolate from.
export const MAX_POSITION_AGE_S = 60;
// Fastest ground speed worth looking ahead for when sizing the ADS-B query circle.
export const LOOKAHEAD_SPEED_KT = 600;

const EARTH_RADIUS_KM = 6371;
const KM_PER_NM = 1.852;
const DEG_TO_RAD = Math.PI / 180;

export type CompassPoint = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

const COMPASS_POINTS: readonly CompassPoint[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface PassPrediction {
  secondsToClosest: number;
  closestDistanceKm: number;
  // True when the closest approach is less than LEAD_MIN_S away (or already behind).
  alreadyClose: boolean;
  // Direction from home to the aircraft's current position.
  approachFrom: CompassPoint;
}

// The user's radius plus the distance a LOOKAHEAD_SPEED_KT aircraft covers in LEAD_MAX_S.
// The ADS-B client caps the query at the APIs' 250 nm maximum.
export function queryRadiusKm(radiusKm: number): number {
  return radiusKm + (LOOKAHEAD_SPEED_KT * KM_PER_NM * LEAD_MAX_S) / 3600;
}

function toCompassPoint(x: number, y: number): CompassPoint {
  const bearingDeg = (Math.atan2(x, y) / DEG_TO_RAD + 360) % 360;
  return COMPASS_POINTS[Math.round(bearingDeg / 45) % 8] ?? "N";
}

// Returns a prediction only when an alert is due: closest approach within radiusKm and at most LEAD_MAX_S away.
export function predictPass(
  aircraft: AircraftState,
  home: { lat: number; lon: number },
  radiusKm: number,
): PassPrediction | null {
  if (aircraft.onGround || aircraft.trackDeg === null || aircraft.groundSpeedKt === null) {
    return null;
  }
  const ageS = aircraft.positionAgeS ?? 0;
  if (ageS > MAX_POSITION_AGE_S) {
    return null;
  }

  // Local flat frame around home, in km: x east, y north.
  const speedKmS = (aircraft.groundSpeedKt * KM_PER_NM) / 3600;
  const trackRad = aircraft.trackDeg * DEG_TO_RAD;
  const vx = speedKmS * Math.sin(trackRad);
  const vy = speedKmS * Math.cos(trackRad);
  // Move the reported position forward by its age along the current track.
  const x = (aircraft.lon - home.lon) * DEG_TO_RAD * Math.cos(home.lat * DEG_TO_RAD) * EARTH_RADIUS_KM + vx * ageS;
  const y = (aircraft.lat - home.lat) * DEG_TO_RAD * EARTH_RADIUS_KM + vy * ageS;

  // Time of closest approach; zero when stationary or when the closest point is already behind.
  const speedSq = vx * vx + vy * vy;
  const secondsToClosest = speedSq === 0 ? 0 : Math.max(0, -(x * vx + y * vy) / speedSq);
  const closestDistanceKm = Math.hypot(x + vx * secondsToClosest, y + vy * secondsToClosest);

  if (closestDistanceKm > radiusKm || secondsToClosest > LEAD_MAX_S) {
    return null;
  }
  return {
    secondsToClosest,
    closestDistanceKm,
    // Exactly LEAD_MIN_S is still a regular alert.
    alreadyClose: secondsToClosest < LEAD_MIN_S,
    approachFrom: toCompassPoint(x, y),
  };
}
