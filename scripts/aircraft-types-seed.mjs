// Aircraft types dictionary generator: downloads db/icao_aircraft_types2.js from tar1090-db and prints an
// `insert into public.aircraft_types` statement to paste into a new migration (seed.sql only runs on a local db reset).
// Zero dependencies on purpose. Run: `npm run -s aircraft-types:seed >> supabase/migrations/<timestamp>_x.sql`

import { gunzipSync } from "node:zlib";

const REPO = "wiedehopf/tar1090-db";
const SOURCE_PATH = "db/icao_aircraft_types2.js";
const TIMEOUT_MS = 30_000;
const ICAO_TYPE_PATTERN = /^[A-Z0-9]{2,4}$/;
// Changing this list means a new migration (the UI does not edit featured types).
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

async function get(url, accept) {
  try {
    const response = await fetch(url, {
      headers: accept ? { Accept: accept } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) fail(`Fetch failed: HTTP ${response.status} for ${url}`);
    return response;
  } catch (error) {
    fail(`Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Pin the download to the latest commit touching the file, so the SQL header names exactly what was imported.
const commits = await (
  await get(
    `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(SOURCE_PATH)}&per_page=1`,
    "application/vnd.github+json",
  )
).json();
const commitSha = Array.isArray(commits) && typeof commits[0]?.sha === "string" ? commits[0].sha : null;
if (commitSha === null) fail(`Could not resolve the latest commit of ${SOURCE_PATH} in ${REPO}.`);
const sourceUrl = `https://raw.githubusercontent.com/${REPO}/${commitSha}/${SOURCE_PATH}`;

// The file is gzip despite its .js extension; fetch only decompresses on Content-Encoding, so check the magic bytes.
let bytes = Buffer.from(await (await get(sourceUrl)).arrayBuffer());
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
  // Pseudo-types without a name (TWR, GND, BALL, …) and codes outside the icao_type domain are left out.
  if (!name || !ICAO_TYPE_PATTERN.test(code)) continue;
  rows.push({ code, name, featured: FEATURED.includes(code) });
}

const present = new Set(rows.map((row) => row.code));
const missing = FEATURED.filter((code) => !present.has(code));
if (missing.length) fail(`Featured type(s) missing or unnamed in source: ${missing.join(", ")}`);

rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const values = rows.map((row) => `  (${quote(row.code)}, ${quote(row.name)}, ${row.featured ? "true" : "false"})`);

// The generated SQL keeps Polish comments, like every migration.
const fetchedOn = new Date().toISOString().slice(0, 10);
console.log(`
-- Dane słownika wygenerowane przez scripts/aircraft-types-seed.mjs (npm run aircraft-types:seed).
-- Źródło: ${sourceUrl}
-- Pobrano: ${fetchedOn}; wierszy: ${rows.length}, wyróżnionych: ${FEATURED.length}.
insert into public.aircraft_types (code, name, featured) values
${values.join(",\n")};`);
