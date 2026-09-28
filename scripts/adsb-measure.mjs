// ADS-B source measurement: checks whether the free feeds (adsb.fi, adsb.lol) and the adsbdb route lookup
// actually deliver what the alert rule needs, before we build on them. Takes ~30 minutes with the defaults.
// Zero dependencies on purpose. Run: node scripts/adsb-measure.mjs (tune with LAT, LON, RADIUS_KM, SAMPLES,
// INTERVAL_S, ROUTE_LOOKUPS). Custom LAT/LON are never printed, so results are safe to paste anywhere.

const DEFAULT_LAT = 52.23;
const DEFAULT_LON = 21.01;
const LAT = Number(process.env.LAT ?? DEFAULT_LAT);
const LON = Number(process.env.LON ?? DEFAULT_LON);
const RADIUS_KM = Number(process.env.RADIUS_KM ?? 100);
const SAMPLES = Number(process.env.SAMPLES ?? 6);
const INTERVAL_S = Number(process.env.INTERVAL_S ?? 300);
const ROUTE_LOOKUPS = Number(process.env.ROUTE_LOOKUPS ?? 10);

// Same rule as src/lib/alert-settings.ts (ICAO_TYPE_PATTERN), applied after trim + toUpperCase.
const ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/;
const USER_AGENT = "nad-glowa/adsb-measure (+https://nad-glowa.mateusz-kosciolko-321.workers.dev)";
const TIMEOUT_MS = 15_000;
// Both APIs take the radius in nautical miles; round up so the circle never shrinks, cap at the API maximum.
const RADIUS_NM = Math.min(250, Math.ceil(RADIUS_KM / 1.852));
const isDefaultPoint = LAT === DEFAULT_LAT && LON === DEFAULT_LON;

const FIELDS = ["hex", "r", "flight", "track", "gs"];
const HEADER = [
  "Źródło",
  "Próbki OK",
  "Czas śr. [ms]",
  "ac śr.",
  "W powietrzu śr.",
  "t niepuste",
  "t zgodne z wzorcem",
  ...FIELDS,
  "Wojskowe (dbFlags&1)",
  "hex ~",
  "seen_pos med / max [s]",
  "Trafienia tras",
];

for (const [name, value] of Object.entries({ LAT, LON, RADIUS_KM, SAMPLES, INTERVAL_S, ROUTE_LOOKUPS })) {
  if (!Number.isFinite(value) || (name !== "LAT" && name !== "LON" && value < 0)) {
    console.log(`Invalid ${name}: expected a non-negative number`);
    process.exit(1);
  }
}

const sources = [
  { name: "adsb.fi", url: `https://opendata.adsb.fi/api/v3/lat/${LAT}/lon/${LON}/dist/${RADIUS_NM}` },
  { name: "adsb.lol", url: `https://api.adsb.lol/v2/point/${LAT}/${LON}/${RADIUS_NM}` },
].map((source) => ({ ...source, stats: newStats() }));

const routes = { lookups: 0, hits: 0, misses: 0, errors: 0, ms: [] };
let routesetPlanes = [];

function newStats() {
  return {
    samples: 0,
    ok: 0,
    ms: [],
    acTotal: 0,
    airborne: 0,
    withType: 0,
    validType: 0,
    fields: Object.fromEntries(FIELDS.map((field) => [field, 0])),
    military: 0,
    nonIcao: 0,
    seenPos: [],
    badTypes: new Set(),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const present = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const pct = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "—");
const avg = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : "—");

function median(values) {
  if (!values.length) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Never throws: a timeout or network error comes back as status 0 so it counts as a failed sample, not a crash.
async function request(url, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return { status: response.status, ms: Math.round(performance.now() - started), text };
  } catch (error) {
    return { status: 0, ms: Math.round(performance.now() - started), text: "", error: error.message };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Airborne = has a position and is not reported as on the ground.
const isAirborne = (ac) => typeof ac.lat === "number" && typeof ac.lon === "number" && ac.alt_baro !== "ground";

function recordSample(stats, aircraft) {
  stats.ok++;
  stats.acTotal += aircraft.length;
  for (const ac of aircraft.filter(isAirborne)) {
    stats.airborne++;
    if (present(ac.t)) {
      stats.withType++;
      const type = String(ac.t).trim().toUpperCase();
      if (ICAO_TYPE_PATTERN.test(type)) stats.validType++;
      else stats.badTypes.add(type);
    }
    for (const field of FIELDS) if (present(ac[field])) stats.fields[field]++;
    if ((ac.dbFlags ?? 0) & 1) stats.military++;
    if (String(ac.hex ?? "").startsWith("~")) stats.nonIcao++;
    if (typeof ac.seen_pos === "number") stats.seenPos.push(ac.seen_pos);
  }
}

async function sampleSource(source) {
  const result = await request(source.url);
  const body = result.status === 200 ? parseJson(result.text) : null;
  const aircraft = Array.isArray(body?.ac) ? body.ac : null;
  source.stats.samples++;
  source.stats.ms.push(result.ms);
  if (aircraft) recordSample(source.stats, aircraft);
  const detail = aircraft
    ? `ac=${aircraft.length} airborne=${aircraft.filter(isAirborne).length}`
    : `FAILED ${result.error ?? "no ac array"}`;
  console.log(`  ${source.name.padEnd(9)} HTTP ${result.status}  ${result.ms} ms  ${detail}`);
  return aircraft ?? [];
}

// adsbdb: HTTP 200 with response.flightroute is a hit; any other answer is a miss; status 0 is a network error.
async function lookupRoutes(aircraft) {
  const airborne = aircraft.filter(isAirborne);
  const callsigns = [...new Set(airborne.map((ac) => String(ac.flight ?? "").trim()).filter(Boolean))];
  const picked = callsigns.slice(0, ROUTE_LOOKUPS);
  for (const [index, callsign] of picked.entries()) {
    if (index > 0) await sleep(1000);
    const result = await request(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
    routes.lookups++;
    routes.ms.push(result.ms);
    if (result.status === 0) routes.errors++;
    else if (result.status === 200 && parseJson(result.text)?.response?.flightroute) routes.hits++;
    else routes.misses++;
  }
  console.log(`  adsbdb    ${picked.length} callsign(s) looked up, hits so far ${routes.hits}/${routes.lookups}`);
  if (!routesetPlanes.length) {
    const withCallsign = airborne.filter((ac) => picked.includes(String(ac.flight ?? "").trim()));
    routesetPlanes = withCallsign.map((ac) => ({ callsign: String(ac.flight).trim(), lat: ac.lat, lng: ac.lon }));
  }
}

// Best effort, once per run: the response shape is unknown, so only show what came back.
async function tryRouteset() {
  if (!routesetPlanes.length) {
    console.log("\nadsb.lol routeset: skipped (no callsigns collected)");
    return;
  }
  const result = await request("https://api.adsb.lol/api/0/routeset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planes: routesetPlanes }),
  });
  console.log(`\nadsb.lol routeset: HTTP ${result.status} ${result.error ?? ""}`);
  console.log(`  ${result.text.slice(0, 300)}`);
}

function sourceRow({ name, stats }) {
  const fieldCells = FIELDS.map((field) => pct(stats.fields[field], stats.airborne));
  return [
    name,
    `${stats.ok}/${stats.samples}`,
    avg(stats.ms),
    stats.ok ? (stats.acTotal / stats.ok).toFixed(1) : "—",
    stats.ok ? (stats.airborne / stats.ok).toFixed(1) : "—",
    pct(stats.withType, stats.airborne),
    pct(stats.validType, stats.withType),
    ...fieldCells,
    stats.military,
    stats.nonIcao,
    `${median(stats.seenPos)} / ${stats.seenPos.length ? Math.max(...stats.seenPos) : "—"}`,
    "—",
  ];
}

function routeRow() {
  const answered = routes.lookups - routes.errors;
  const cells = ["adsbdb (trasy)", `${answered}/${routes.lookups}`, avg(routes.ms)];
  const blanks = Array.from({ length: HEADER.length - cells.length - 1 }, () => "—");
  return [...cells, ...blanks, `${routes.hits}/${routes.lookups} (${pct(routes.hits, routes.lookups)})`];
}

function printTable() {
  const rows = [HEADER, HEADER.map(() => "---"), ...sources.map(sourceRow), routeRow()];
  console.log(rows.map((row) => `| ${row.join(" | ")} |`).join("\n"));
}

const point = isDefaultPoint ? `${LAT}, ${LON}` : "własny (niewypisywany)";
console.log(`Punkt: ${point}; promień ${RADIUS_KM} km = ${RADIUS_NM} nm; próbki ${SAMPLES} co ${INTERVAL_S} s`);

for (let sample = 1; sample <= SAMPLES; sample++) {
  console.log(`\nSample ${sample}/${SAMPLES} (${new Date().toISOString()})`);
  const fiAircraft = await sampleSource(sources[0]);
  await sampleSource(sources[1]);
  await lookupRoutes(fiAircraft);
  if (sample < SAMPLES) await sleep(INTERVAL_S * 1000);
}

await tryRouteset();

console.log("\nTypy spoza wzorca (t):");
for (const { name, stats } of sources) {
  console.log(`  ${name}: ${[...stats.badTypes].sort().join(", ") || "brak"}`);
}

console.log("\n* Odsetki liczone dla samolotów w powietrzu; „t zgodne” liczone wśród niepustych t.\n");
printTable();

const failedSources = sources.filter(({ stats }) => stats.ok === 0);
if (failedSources.length) console.log(`\nNo valid sample from: ${failedSources.map((s) => s.name).join(", ")}`);
process.exit(failedSources.length ? 1 : 0);
