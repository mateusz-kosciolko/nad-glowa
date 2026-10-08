// Generator danych słownika typów: pobiera db/icao_aircraft_types2.js z tar1090-db i wypisuje na stdout SQL
// `insert into public.aircraft_types` do wklejenia w nową migrację (seed.sql działa tylko przy lokalnym db reset).
// Zero dependencies on purpose. Run: `npm run -s aircraft-types:seed >> supabase/migrations/<timestamp>_x.sql`

import { gunzipSync } from "node:zlib";

const SOURCE_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/db/icao_aircraft_types2.js";
const TIMEOUT_MS = 30_000;
const ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/;
// Zmiana tej listy to nowa migracja (UI nie edytuje wyróżnionych).
const FEATURED = [
  "A400",
  "C17",
  "C30J",
  "C130",
  "A124",
  "IL76",
  "AN12",
  "BLCF",
  "A3ST",
  "B748",
  "K35R",
  "E3TF",
  "B52",
  "H47",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

let response;
try {
  response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
} catch (error) {
  fail(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
}
if (!response.ok) fail(`Fetch failed: HTTP ${response.status} for ${SOURCE_URL}`);

// Plik jest gzipem mimo rozszerzenia .js; fetch rozpakowuje tylko przy Content-Encoding, więc sprawdzamy magię.
let bytes = Buffer.from(await response.arrayBuffer());
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);

let source;
try {
  source = JSON.parse(bytes.toString("utf8"));
} catch {
  fail("Source is not valid JSON after decompression.");
}
if (typeof source !== "object" || source === null || Array.isArray(source)) fail("Source is not a JSON object.");

const rows = [];
for (const [code, entry] of Object.entries(source)) {
  const name = Array.isArray(entry) && typeof entry[0] === "string" ? entry[0].trim() : "";
  // Pseudo-typy bez nazwy (TWR, GND, BALL, …) i kody spoza domeny icao_type nie wchodzą do słownika.
  if (!name || !ICAO_TYPE_PATTERN.test(code)) continue;
  rows.push({ code, name, featured: FEATURED.includes(code) });
}

const present = new Set(rows.map((row) => row.code));
const missing = FEATURED.filter((code) => !present.has(code));
if (missing.length) fail(`Featured type(s) missing or unnamed in source: ${missing.join(", ")}`);

rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const values = rows.map((row) => `  (${quote(row.code)}, ${quote(row.name)}, ${row.featured ? "true" : "false"})`);

const fetchedOn = new Date().toISOString().slice(0, 10);
console.log(`
-- Dane słownika wygenerowane przez scripts/aircraft-types-seed.mjs (npm run aircraft-types:seed).
-- Źródło: ${SOURCE_URL}
-- Pobrano: ${fetchedOn}; wierszy: ${rows.length}, wyróżnionych: ${FEATURED.length}.
insert into public.aircraft_types (code, name, featured) values
${values.join(",\n")};`);
