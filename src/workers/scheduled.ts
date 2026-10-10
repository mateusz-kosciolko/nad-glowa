/* eslint-disable no-console -- console is the only output channel of a cron run (wrangler tail / dev terminal) */
import { TELEGRAM_BOT_TOKEN } from "astro:env/server";
import { CRON_RUN_RETENTION_DAYS, describeRunOutcome, type CronRunStatus } from "@/lib/cron-runs";
import { createAdminClient } from "@/lib/supabase-admin";
import { runAlertPoll, type AlertPollSummary } from "@/workers/alert-poller";

const DAY_MS = 24 * 60 * 60 * 1000;

// The run's actual work: one alert poll for every active user.
function runWork(supabase: NonNullable<ReturnType<typeof createAdminClient>>): Promise<AlertPollSummary> {
  return runAlertPoll(supabase, () => new Date(), TELEGRAM_BOT_TOKEN);
}

function describeSummary(summary: AlertPollSummary | null): string {
  if (!summary) {
    return "";
  }
  const { users, polled, matches, duplicates, sent, routes } = summary;
  return (
    `; users: ${users}, polled: ${polled}, matches: ${matches}, duplicates: ${duplicates}, sent: ${sent}` +
    `, routes: ${routes}`
  );
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
  let status: CronRunStatus;
  let runError: string | null;
  let summary: AlertPollSummary | null = null;
  try {
    summary = await runWork(supabase);
    ({ status, error: runError } = describeRunOutcome({ errors: summary.errors }));
  } catch (error) {
    ({ status, error: runError } = describeRunOutcome({ thrown: error }));
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
        `${runError ? `: ${runError}` : ""}${describeSummary(summary)}; recorded: ${insertError ? "no" : "yes"}; pruned: ${pruned ?? 0}`,
    );
  } catch (error) {
    console.error(`[cron] run at ${startedAt.toISOString()} bookkeeping failed: ${describeError(error)}`);
  }
}
