// Integration tests for the alert poller (src/workers/**/*.integration.test.ts). Runs in plain Node, without
// Astro's getViteConfig, the Cloudflare adapter or workerd. The edges are faked: outbound fetch is answered
// per host (adsb.fi, route lookup, Telegram) and Supabase is an in-memory fake, so no network or database is
// needed. Tested modules must not import any astro:* module; the poller receives its client, clock and token
// as parameters.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors `paths` in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/workers/**/*.integration.test.ts"],
    environment: "node",
    // Restores the fetch stub after every test even if a test file forgets its own vi.unstubAllGlobals().
    unstubGlobals: true,
  },
});
