// Shared by the scheduled handler and the pages that read the run log: no server-only imports here.

// Must match the retention the scheduled handler applies; older rows are deleted after each run.
export const CRON_RUN_RETENTION_DAYS = 7;

// Must match the status check in supabase/migrations/20260928180224_cron_runs.sql.
export type CronRunStatus = "ok" | "error";

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
