// Custom Worker entry: Astro's fetch handler plus the cron handler. Importing the adapter handler at module
// level also populates astro:env/server, which the scheduled handler relies on.
import { handle } from "@astrojs/cloudflare/handler";
import { handleScheduled } from "@/workers/scheduled";

export default {
  fetch: handle,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env>;
