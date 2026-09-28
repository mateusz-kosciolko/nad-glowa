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
