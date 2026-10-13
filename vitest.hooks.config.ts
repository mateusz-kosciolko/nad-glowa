// Proof for the Claude Code agent hooks in .claude/hooks/ (scripts/__tests__/agent-hooks.test.mjs). Each case
// pipes a hook payload into the real script inside a throwaway git repo, so it spawns bash, git and npx and
// takes tens of seconds; kept out of `npm test`, which end-of-turn.sh runs on every turn. end-of-turn.sh runs
// this suite only when the hooks, .claude/settings.json or the test itself changed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.mjs"],
    environment: "node",
    testTimeout: 60_000,
    maxConcurrency: 12,
  },
});
