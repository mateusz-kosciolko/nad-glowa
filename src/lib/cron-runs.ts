// Shared by the scheduled handler and the pages that read the run log: no server-only imports here.

// Must match the retention the scheduled handler applies; older rows are deleted after each run.
export const CRON_RUN_RETENTION_DAYS = 7;

// Must match the status check in supabase/migrations/20260928180224_cron_runs.sql.
export type CronRunStatus = "ok" | "error";

// Bounds cron_runs.error when many users fail in the same run (or a thrown message is long).
export const MAX_RUN_ERROR_CHARS = 500;

// A finished run reports its collected errors; a crashed one, what it threw. Takes the errors structurally,
// so this module does not import from src/workers.
export type RunOutcome = { errors: readonly string[] } | { thrown: unknown };

// Maps a run's outcome to the status and error text stored in cron_runs (and logged).
export function describeRunOutcome(outcome: RunOutcome): { status: CronRunStatus; error: string | null } {
  if ("thrown" in outcome) {
    const { thrown } = outcome;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { status: "error", error: message.slice(0, MAX_RUN_ERROR_CHARS) };
  }
  if (outcome.errors.length > 0) {
    return { status: "error", error: outcome.errors.join("; ").slice(0, MAX_RUN_ERROR_CHARS) };
  }
  return { status: "ok", error: null };
}

export interface CronRun {
  id: number;
  started_at: string;
  duration_ms: number;
  status: CronRunStatus;
  // Null for "ok" runs; the migration enforces it.
  error: string | null;
}

// The clock ticks every 60 s; five missed ticks means it stopped rather than hiccuped
// (threshold from the silent-cron risk in context/foundation/infrastructure.md).
export const HEARTBEAT_STALE_AFTER_MS = 5 * 60_000;

export type LastRunDescription = { state: "never" } | { state: "fresh" | "stale"; ageSeconds: number };

// Exactly HEARTBEAT_STALE_AFTER_MS old is still fresh; only older runs are stale.
export function describeLastRun(lastStartedAt: string | null, now: Date): LastRunDescription {
  if (lastStartedAt === null) {
    return { state: "never" };
  }
  // A run stamped slightly in the future (clock skew) counts as just now.
  const ageMs = Math.max(0, now.getTime() - new Date(lastStartedAt).getTime());
  return {
    state: ageMs > HEARTBEAT_STALE_AFTER_MS ? "stale" : "fresh",
    ageSeconds: Math.floor(ageMs / 1000),
  };
}
