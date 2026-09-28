// Local cron clock: `npm run dev` does not fire Cron Triggers, so this script calls the scheduled handler
// every 60 s for as long as the terminal runs. Needs a running dev server.
// Zero dependencies on purpose. Run: BASE_URL=http://localhost:4321 node scripts/cron-local.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 30_000;
const URL_PATH = "/cdn-cgi/handler/scheduled?cron=*+*+*+*+*";

async function tick() {
  const at = new Date().toISOString();
  try {
    const response = await fetch(BASE_URL + URL_PATH, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.text();
    console.log(`${at}  ${response.ok ? "OK  " : "FAIL"}  HTTP ${response.status}`);
  } catch (error) {
    // Keep looping: the dev server may simply not be up yet.
    const reason = error instanceof Error ? (error.cause?.code ?? error.message) : String(error);
    console.log(`${at}  FAIL  network error: ${reason}`);
  }
}

console.log(`cron:local -> ${BASE_URL}${URL_PATH} every ${INTERVAL_MS / 1000} s (Ctrl+C to stop)`);
await tick();
setInterval(() => void tick(), INTERVAL_MS);
