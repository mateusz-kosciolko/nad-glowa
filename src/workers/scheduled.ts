// Cron entry point. Runs without a user session, so it is the only module allowed to use
// the service_role client (see eslint.config.js).
export function handleScheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
  // eslint-disable-next-line no-console -- the run log line is the only output of this phase
  console.log(`[cron] run at ${new Date(controller.scheduledTime).toISOString()} (cron: ${controller.cron})`);
  return Promise.resolve();
}
