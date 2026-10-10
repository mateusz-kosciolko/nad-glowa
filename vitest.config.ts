// Unit tests for pure src/lib modules only. Deliberately not Astro's getViteConfig, so tests never load
// the Cloudflare adapter or workerd.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors `paths` in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
  },
});
