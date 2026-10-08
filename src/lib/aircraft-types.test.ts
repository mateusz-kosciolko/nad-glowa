import { describe, expect, it } from "vitest";
import { normalizeTypeQuery, rankAircraftTypes, SEARCH_LIMIT, type AircraftType } from "@/lib/aircraft-types";

describe("normalizeTypeQuery", () => {
  it("rejects a query shorter than 2 characters", () => {
    expect(normalizeTypeQuery("")).toBeNull();
    expect(normalizeTypeQuery("c")).toBeNull();
    expect(normalizeTypeQuery("  c  ")).toBeNull();
  });

  it("rejects a query longer than 40 characters", () => {
    expect(normalizeTypeQuery("a".repeat(40))).toBe("a".repeat(40));
    expect(normalizeTypeQuery("a".repeat(41))).toBeNull();
  });

  it.each([",", "%", "(", ")", "_", "*", "."])("rejects a query containing %s", (char) => {
    expect(normalizeTypeQuery(`c1${char}7`)).toBeNull();
  });

  it("rejects a filter injection attempt", () => {
    expect(normalizeTypeQuery("a,code.neq.x")).toBeNull();
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeTypeQuery("  super   hercules ")).toBe("super hercules");
  });

  it("accepts letters, digits, hyphen and slash", () => {
    expect(normalizeTypeQuery("il-76/82")).toBe("il-76/82");
  });
});

describe("rankAircraftTypes", () => {
  const c17: AircraftType = { code: "C17", name: "BOEING C-17 Globemaster 3" };
  const c172: AircraftType = { code: "C172", name: "CESSNA 172 Skyhawk" };
  const nameMatch: AircraftType = { code: "ZZ01", name: "Something C17 related" };
  const other: AircraftType = { code: "A400", name: "AIRBUS A-400M" };

  it("puts the exact code first", () => {
    expect(rankAircraftTypes("C17", [nameMatch, c172, c17])).toEqual([c17, c172, nameMatch]);
  });

  it("puts a code prefix before a name match", () => {
    expect(rankAircraftTypes("C17", [nameMatch, c172])).toEqual([c172, nameMatch]);
  });

  it("sorts by code within a group", () => {
    const b: AircraftType = { code: "C30J", name: "LOCKHEED MARTIN C-130J Super Hercules" };
    const a: AircraftType = { code: "C130", name: "LOCKHEED C-130 Hercules" };
    expect(rankAircraftTypes("hercules", [b, a])).toEqual([a, b]);
  });

  it("ignores letter case", () => {
    expect(rankAircraftTypes("c17", [nameMatch, c172, c17])).toEqual([c17, c172, nameMatch]);
    expect(rankAircraftTypes("airbus", [other])).toEqual([other]);
  });

  it("drops types that do not match", () => {
    expect(rankAircraftTypes("C17", [other, c17])).toEqual([c17]);
  });

  it(`returns at most ${String(SEARCH_LIMIT)} results`, () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ code: `B7${String(i).padStart(2, "0")}`, name: "BOEING" }));
    const result = rankAircraftTypes("B7", many);
    expect(result).toHaveLength(SEARCH_LIMIT);
    expect(result[0]?.code).toBe("B700");
  });
});
