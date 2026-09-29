/* eslint-disable no-console -- console is the only output channel of a cron run (wrangler tail / dev terminal) */
import { CRON_RUN_RETENTION_DAYS, type CronRunStatus } from "@/lib/cron-runs";
import { createAdminClient } from "@/lib/supabase-admin";

const DAY_MS = 24 * 60 * 60 * 1000;

// The run's actual work. Empty in F-02; the S-03 poller plugs in here.
function runWork(): Promise<void> {
  return Promise.resolve();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Cron entry point. Runs without a user session, so it is the only module allowed to use
// the service_role client (see eslint.config.js).
// Never throws: a missing key or a failed write ends in a log line, so the Worker keeps serving requests.
export async function handleScheduled(
  controller: ScheduledController,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    // supabase-js throws on a malformed SUPABASE_URL; keep the "never throws" contract.
    console.error(`[cron] skipped run (cron: ${controller.cron}): Supabase client failed: ${describeError(error)}`);
    return;
  }
  if (!supabase) {
    console.warn(`[cron] skipped run (cron: ${controller.cron}): SUPABASE_SERVICE_KEY is not configured`);
    return;
  }

  const startedAt = new Date();
  let status: CronRunStatus = "ok";
  let runError: string | null = null;
  try {
    await runWork();
  } catch (error) {
    status = "error";
    runError = describeError(error);
  }
  const durationMs = Math.max(0, Date.now() - startedAt.getTime());

  try {
    const { error: insertError } = await supabase
      .from("cron_runs")
      .insert({ started_at: startedAt.toISOString(), duration_ms: durationMs, status, error: runError });
    if (insertError) {
      console.error(`[cron] run at ${startedAt.toISOString()} not recorded: ${insertError.message}`);
    }

    // Retention runs even when the insert failed, so the table cannot grow without bound.
    const cutoff = new Date(Date.now() - CRON_RUN_RETENTION_DAYS * DAY_MS).toISOString();
    const { error: pruneError, count: pruned } = await supabase
      .from("cron_runs")
      .delete({ count: "exact" })
      .lt("started_at", cutoff);
    if (pruneError) {
      console.error(`[cron] pruning runs older than ${cutoff} failed: ${pruneError.message}`);
    }

    console.log(
      `[cron] run at ${startedAt.toISOString()} (cron: ${controller.cron}) ${status} in ${durationMs} ms` +
        `${runError ? `: ${runError}` : ""}; recorded: ${insertError ? "no" : "yes"}; pruned: ${pruned ?? 0}`,
    );
  } catch (error) {
    console.error(`[cron] run at ${startedAt.toISOString()} bookkeeping failed: ${describeError(error)}`);
  }
}
