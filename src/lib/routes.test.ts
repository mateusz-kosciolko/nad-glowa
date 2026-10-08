import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRoute, lookupRoute, parseRouteResponse, ROUTE_LOOKUP_TIMEOUT_MS } from "@/lib/routes";

// Trimmed copy of a real adsbdb answer for LOT3.
const HIT = {
  response: {
    flightroute: {
      callsign: "LOT3",
      callsign_icao: "LOT3",
      callsign_iata: "LO3",
      airline: { name: "LOT Polish Airlines", icao: "LOT", iata: "LO", country: "Poland" },
      origin: {
        country_iso_name: "PL",
        iata_code: "WAW",
        icao_code: "EPWA",
        municipality: "Warsaw",
        name: "Warsaw Chopin Airport",
      },
      destination: {
        country_iso_name: "US",
        iata_code: "ORD",
        icao_code: "KORD",
        municipality: "Chicago",
        name: "Chicago O'Hare International Airport",
      },
    },
  },
};

const MISS = { response: "unknown callsign" };

function withAirports(origin: Record<string, unknown>, destination: Record<string, unknown>) {
  return { response: { flightroute: { ...HIT.response.flightroute, origin, destination } } };
}

describe("parseRouteResponse", () => {
  it("reads codes and cities from a hit", () => {
    expect(parseRouteResponse(HIT)).toEqual({
      origin: { code: "WAW", city: "Warsaw" },
      destination: { code: "ORD", city: "Chicago" },
    });
  });

  it("returns null for an unknown callsign", () => {
    expect(parseRouteResponse(MISS)).toBeNull();
  });

  it("returns null for a body without a flight route", () => {
    expect(parseRouteResponse({ response: {} })).toBeNull();
    expect(parseRouteResponse(null)).toBeNull();
    expect(parseRouteResponse("nope")).toBeNull();
  });

  it("falls back to the ICAO code when the IATA code is missing or blank", () => {
    const route = parseRouteResponse(
      withAirports({ icao_code: "EPWA", municipality: "Warsaw" }, { iata_code: "  ", icao_code: "KORD" }),
    );
    expect(route?.origin.code).toBe("EPWA");
    expect(route?.destination.code).toBe("KORD");
  });

  it("maps a blank municipality to a null city", () => {
    const route = parseRouteResponse(withAirports({ iata_code: "WAW", municipality: " " }, { iata_code: "ORD" }));
    expect(route?.origin.city).toBeNull();
    expect(route?.destination.city).toBeNull();
  });

  it("collapses newlines in a city and caps its length", () => {
    const origin = { ...HIT.response.flightroute.origin, municipality: "War\nsaw\t City" };
    const destination = { ...HIT.response.flightroute.destination, municipality: "x".repeat(200) };
    const route = parseRouteResponse({ response: { flightroute: { origin, destination } } });
    expect(route?.origin.city).toBe("War saw City");
    expect(route?.destination.city).toHaveLength(60);
  });

  it("falls back to the ICAO code when the IATA code is longer than 4 characters", () => {
    const origin = { ...HIT.response.flightroute.origin, iata_code: "WAWWAW" };
    const route = parseRouteResponse({ response: { flightroute: { ...HIT.response.flightroute, origin } } });
    expect(route?.origin.code).toBe("EPWA");
  });

  it("returns null when an airport has neither code", () => {
    expect(parseRouteResponse(withAirports({ municipality: "Warsaw" }, { iata_code: "ORD" }))).toBeNull();
  });
});

describe("formatRoute", () => {
  it("shows the city with the code in brackets", () => {
    expect(
      formatRoute({ origin: { code: "WAW", city: "Warsaw" }, destination: { code: "ORD", city: "Chicago" } }),
    ).toBe("Warsaw (WAW) → Chicago (ORD)");
  });

  it("shows the bare code for an airport without a city", () => {
    expect(formatRoute({ origin: { code: "EPWA", city: null }, destination: { code: "ORD", city: "Chicago" } })).toBe(
      "EPWA → Chicago (ORD)",
    );
  });
});

describe("lookupRoute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns the route for a hit", async () => {
    stubFetch(() => Promise.resolve(Response.json(HIT)));
    expect(await lookupRoute("LOT3")).toEqual({
      origin: { code: "WAW", city: "Warsaw" },
      destination: { code: "ORD", city: "Chicago" },
    });
  });

  it("returns null for a 404", async () => {
    stubFetch(() => Promise.resolve(Response.json(MISS, { status: 404 })));
    expect(await lookupRoute("XXX999")).toBeNull();
  });

  it("returns null on a network error", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await lookupRoute("LOT3")).toBeNull();
  });

  it("returns null on a timeout", async () => {
    stubFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    expect(await lookupRoute("LOT3")).toBeNull();
  });

  it("returns null for a 200 with a non-JSON body", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>oops</html>", { status: 200 })));
    expect(await lookupRoute("LOT3")).toBeNull();
  });

  it("requests the callsign URL with a timeout and the app's User-Agent", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(MISS, { status: 404 })));
    await lookupRoute("LOT3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.adsbdb.com/v0/callsign/LOT3");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("User-Agent")).toContain("nad-glowa");
    expect(ROUTE_LOOKUP_TIMEOUT_MS).toBe(2000);
  });

  it("skips the request for a callsign that is not 2-8 letters or digits", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(HIT, { status: 200 })));
    expect(await lookupRoute("AB C/1")).toBeNull();
    expect(await lookupRoute("..")).toBeNull();
    expect(await lookupRoute("A")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
