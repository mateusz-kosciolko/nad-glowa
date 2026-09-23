---
project: nad-glowa
researched_at: 2026-09-23
recommended_platform: Cloudflare Workers
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 SSR (React 19 islands)
  runtime: Cloudflare workerd
---

## Recommendation

**Deploy on Cloudflare Workers** (Workers with Static Assets — _not_ Pages).

The decision is driven by one requirement the PRD makes non-negotiable: a notification must reach the user in under 60 seconds, which needs a scheduled job firing roughly every minute. Cloudflare is the only shortlisted platform where a `* * * * *` Cron Trigger is a first-class, documented primitive rather than a workaround — Vercel's Hobby plan caps crons at once per day (a 1-minute schedule fails at deploy time and forces Pro at $20/mo), Railway's documented floor is 5 minutes, Render's cron re-provisions a container on every run, and Netlify's scheduled functions carry no delivery guarantee and had two documented 2026 incidents of silently ceasing to fire. Against the interview answers — **minimize cost**, **no prior platform familiarity**, **single region**, **external database** — Cloudflare lands at **$5/month** (Workers Paid, required because free-plan crons are capped at 10 ms CPU), scores Pass on four of five agent-friendly criteria, and publishes the best agent-readable documentation of the six (`llms.txt`, `llms-full.txt`, `/index.md` on any page, and `Accept: text/markdown`). It is also already the scaffolded target: `@astrojs/cloudflare` v14, `wrangler.jsonc` with `nodejs_compat`, and `wrangler` v4 are committed, so choosing anything else spends part of an 8-week after-hours budget on an adapter migration that buys nothing.

## Platform Comparison

Hard filters applied before scoring:

- **Persistent connections**: answered _No_ — no platform eliminated on this axis.
- **Runtime compatibility**: all six run TypeScript; Astro SSR adapters exist for Cloudflare, Vercel and Netlify, and `@astrojs/node` covers Fly.io, Railway and Render. No platform eliminated.

The separating constraint is therefore not the hard filter but the PRD's sub-60-second NFR, which is weighted heavily below.

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Score   |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | ------- |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Partial           | **4.5** |
| Vercel                 | Pass      | Pass               | Pass                | Pass              | Partial           | 4.5     |
| Railway                | Partial   | Pass               | Pass                | Pass              | Pass              | 4.5     |
| Fly.io                 | Pass      | Partial            | Pass                | Partial           | Pass              | 4.0     |
| Render                 | Partial   | Pass               | Pass                | Partial           | Pass              | 4.0     |
| Netlify                | Partial   | Pass               | Pass                | Partial           | Pass              | 3.5     |

**Cloudflare Workers** — `wrangler` v4 (4.136.3 current; repo pins `^4.131.1`) covers the whole loop: `wrangler deploy`, `wrangler rollback`, `wrangler versions deploy`, `wrangler tail`, `wrangler secret put`. Fully managed, no OS surface. Docs are purpose-built for agents. MCP is scored **Partial** only because Cloudflare ships official servers (`mcp.cloudflare.com` Code Mode, plus domain-specific `*.mcp.cloudflare.com`) without labelling them GA. Deprecated commands to avoid: `wrangler publish`, `wrangler pages publish`, `wrangler generate`, Workers Sites.

**Vercel** — technically excellent and the best agent docs of the six (`llms.txt`, every page as `.md` with `last_updated` frontmatter, `.graph.md` cross-link maps). Ruled out on cost: the Hobby plan's cron minimum is **once per day** with ±59 min precision, so `*/1 * * * *` is rejected at deploy; 1-minute crons require **Pro at $20/mo**. Hobby separately forbids commercial use. Two further agent hazards: Vercel's first-party Astro page (updated 2026-08-26) is stale — it still documents `@astrojs/vercel/serverless` and `output: 'hybrid'`, neither of which exists in adapter v11's export map — and new projects default to the `iad1` US region unless `"regions": ["fra1"]` is set explicitly.

**Railway** — genuinely strong: Railpack builds a Node/Astro app with zero config, Amsterdam EU region, `llms.txt` plus `.md` on every docs URL, an official MCP server, a public GraphQL API, and ~$4–6/mo covered largely by Hobby's $5 credit. Two gaps: **rollback is not in the CLI** (dashboard or API only), and the cron floor is **5 minutes**, so the 1-minute poll would have to become an always-on worker service running `node-cron` — more moving parts, more cost, and app-sleeping must be kept off.

**Fly.io** — cheapest at ~$4–5/mo, `flyctl` is comprehensive, `fly mcp server --claude` is first-class, and `llms.txt` exists. Marked Partial on _Managed_ because you own the Dockerfile (a January 2026 community thread reports `fly launch` failing to generate one for modern Astro, with no staff fix), and Partial on _Stable deploy API_ because **there is no rollback command** — the official guide has you redeploy an old image digest, which does not restore `fly.toml` or secrets, and images expire from the registry. The 1-minute cron needs Supercronic in-container or the community `cron-manager` project, since built-in scheduled Machines only accept `hourly|daily|weekly|monthly`. No EU region closer than Frankfurt (~20–30 ms from Poland, acceptable).

**Render** — surprisingly good agent story (CLI GA since Dec 2024, hosted MCP GA since Aug 2025 with 20+ tools, `llms.txt` plus `.md` docs) but the most expensive at a realistic **~$14/mo** floor: cron jobs and background workers have no free instance, and a free web service still spins down after 15 minutes with a ~60 s cold start. Its cron model re-provisions a fresh container per run, so a 1-minute job pays a boot tax every minute — Render's own docs push you toward a background worker with an in-process scheduler instead. No CLI rollback.

**Netlify** — scored lowest and would be actively risky here. There is **no `netlify rollback` command** (UI or restore-deploy API only). Scheduled functions publish **no delivery or timing guarantee**, and 2026 saw two documented incidents where schedules silently stopped firing with no errors and no logs, plus duplicate-fire reports — for a product whose entire value is a timely push, that is the wrong failure mode. The April 2026 credit model makes Free a **hard limit that pauses the site** when exhausted, with no overage purchase; the scheduled job alone (~43k runs/mo) would consume roughly 240 of the 300 free credits before any traffic or deploys. Function region selection is Pro-only, pinning Free and Personal plans to US-East.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on the one axis that the PRD makes load-bearing — a documented, supported 1-minute Cron Trigger — while also being cheapest-but-one, fully managed, and best-documented for agents. The decisive secondary factor is that the repository is already configured for it: changing platforms now means swapping the Astro adapter, rewriting `wrangler.jsonc` away, and re-solving Supabase cookie handling on a new runtime, against a hard 2026-12-06 deadline with after-hours capacity only.

#### 2. Railway

The best fallback if Cloudflare's execution model proves too constraining — specifically if the prediction workload exceeds the 30 s CPU or per-invocation subrequest budget, or if the poller needs to hold state between ticks. Railway trades the serverless limits for an ordinary always-on Node process with no CPU ceiling, keeps a managed zero-Dockerfile build, and sits in Amsterdam near Supabase EU. The price is a second always-on service, a CLI without rollback, and giving up the platform-native scheduler.

#### 3. Fly.io

Third because it is the cheapest and has the strongest first-class agent integration (`fly mcp` shipped inside `flyctl`), but it pushes the most operational burden back onto a solo developer: you maintain the Dockerfile, you build your own 1-minute scheduler with Supercronic, and rollback is a manual image-digest redeploy that silently drops config. Reasonable if the app later needs long-lived connections or unbounded CPU; over-priced in _effort_ for this MVP.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The free tier is not real for this workload.** Free-plan Cron Triggers are capped at **10 ms CPU** per invocation (paid: 30 s). An ADS-B poll plus closest-approach computation plus notification dispatch will not fit in 10 ms. Workers Paid at $5/mo is required from day one — any plan that budgets $0 is wrong.
2. **Subrequest limits bite the fan-out.** Free allows **50 subrequests per invocation**; paid raises it substantially. A naive cron that issues one Supabase write and one notification call per matching aircraft will exceed the budget on a busy tick. The job must batch into a single bulk upsert and a bounded number of outbound calls.
3. **Cron Triggers carry no timing or delivery SLA.** Cloudflare publishes no exactness guarantee, configuration changes take up to 15 minutes to propagate, and there is no retry or dead-letter path for a missed tick. The `<60 s` NFR rests on a best-effort scheduler; one skipped invocation is one silently missed flyover.
4. **`@supabase/ssr` on workerd has a live breakage class.** Supabase issue #37592 — _"dynamic require of stream is not supported"_ — surfaces without the correct `nodejs_compat` + `compatibility_date` pairing. The repo pins `compatibility_date: 2026-05-08` and `@supabase/ssr ^0.12.7`; a caret bump on either can resurrect it, and with no unit test runner configured (only `npm run smoke`) it fails at deploy, not at build.
5. **No SMTP on workerd.** PRD open question #3 ("Telegram or e-mail?") is silently constrained by the platform: Telegram is a single HTTPS call and works; e-mail requires a third-party HTTP API (MailChannels ended free Workers sending in 2024), adding an account, a secret and a failure mode. Choosing Cloudflare partially decides a product question that is still open.

### Pre-Mortem — How This Could Fail

It shipped in week six and worked beautifully in testing. The failure was slow. The cron was written the obvious way — fetch the ADS-B feed, loop over aircraft, and for each match do a Supabase lookup and a notification call. With three aircraft in the test sky it was fine. In November, with weather diverting traffic over the area, one tick hit forty aircraft, blew the subrequest budget mid-loop, and the invocation died. No alert fired. Nothing logged an error the author was watching, because the failure was a truncated loop, not an exception. Meanwhile the author had been pausing alerts at night (FR-006) — so the Supabase free project, no longer touched, paused after seven days of inactivity. Alerts never resumed. He discovered it three weeks later, when an A400M passed overhead and his phone stayed silent. The root assumption was that "one minute" and "it worked when I tested it" were the same guarantee at forty aircraft as at three. The deadline had passed. Nobody had built a heartbeat that says _the poller ran and found nothing_, so silence and success looked identical.

### Unknown Unknowns

- **Two deploy paths that look alike, one silently wrong.** `wrangler pages deploy` still exists and appears to succeed, but it bypasses `wrangler.jsonc` — meaning no cron triggers and no compatibility flags. `tech-stack.md` frontmatter currently says `deployment_target: cloudflare-pages`, which points a future agent at exactly that path. Correct the contract before it is read.
- **`wrangler dev` is no longer part of this workflow.** `npm run dev` is `astro dev`, and `@astrojs/cloudflare` v14 runs workerd inside Vite. Every tutorial recommending `wrangler pages dev ./dist` is obsolete for these pinned versions and will mislead.
- **The cron cannot be tested through a preview URL.** Scheduled handlers bind to the deployed Worker. Local verification requires `wrangler dev --test-scheduled` plus a manual request to `/__scheduled`. This appears on no marketing page.
- **Cron trigger limits are per-account, not per-project** — 5 on free, 250 on paid. If this Cloudflare account also hosts other projects, that ceiling is shared.
- **Undocumented cross-provider interaction:** the 1-minute cron keeps the Supabase free project warm, which _hides_ Supabase's 7-day inactivity pause. Pausing alerts for a holiday (FR-006) can let the database pause underneath the application.
- **One upside unknown:** Workers Paid $5 is an account-level floor, not per-Worker — additional projects on the same account add no platform fee.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a preview version with its own `<version-id>-<worker>.workers.dev` URL without taking production traffic; `wrangler versions deploy` promotes it. Preview URLs are public by default — put Cloudflare Access in front of them before any real home-location data exists, since the PRD treats home location as sensitive. **Scheduled handlers do not fire on preview versions**, so the cron is verified locally (`wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled"`) and again after promotion, never on a preview URL.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` (plus the future notification-channel token) live as Workers Secrets, set with `wrangler secret put <NAME>` and readable only through `astro:env/server` per the project's hard rule. Locally they come from `.dev.vars`, which stays out of git. Values are write-only once set — the dashboard and CLI never show them back — so rotation is `wrangler secret put` again followed by a redeploy. GitHub Actions gets a **scoped** `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit for this project only — no DNS, no billing, no unrelated Workers) stored in GitHub Secrets, never in the repo.
- **Rollback**: `wrangler rollback` returns to the previous version, or `wrangler versions deploy <version-id>` targets a specific one; `wrangler deployments list` shows the history. Time-to-revert is under a minute and requires no rebuild, because versions are immutable uploads. **Caveat**: rolling back the Worker does not roll back Supabase schema migrations, and it does not un-send a notification. A migration that dropped a column will still be dropped after the rollback.
- **Approval**: an agent may run `wrangler deploy`, `wrangler tail`, `wrangler versions upload`, `wrangler rollback` and `wrangler deployments list` unattended. A human performs, by hand in the dashboard: deleting the Worker or the Cloudflare project, rotating the Supabase service key, dropping or resetting the Supabase database, changing the account's billing plan, and creating or widening API tokens. Destructive and irreversible operations stay manual even when the agent proposes them.
- **Logs**: `wrangler tail` streams live runtime logs (including scheduled invocations, which are tagged as such); `observability.enabled: true` is already set in `wrangler.jsonc`, so historical logs and queries are available through Workers Logs in the dashboard and the observability MCP server. CI logs come from `gh run view --log`. All read-only — no log call mutates state.

## Risk Register

| Risk                                                                                                                                                                              | Source                        | Likelihood | Impact | Mitigation                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cron tick exceeds the per-invocation subrequest budget on a busy sky, truncating the loop without raising an error                                                                | Devil's advocate              | M          | H      | Batch all Supabase writes into one bulk upsert; cap outbound notification calls per tick and queue the remainder to the next run; assert the subrequest count in the handler and log when it crosses 60% of budget |
| Silent cron failure — the job stops firing and silence is indistinguishable from "no interesting aircraft"                                                                        | Pre-mortem                    | M          | H      | Write a heartbeat row (`last_run_at`, `aircraft_seen`) on every invocation, including empty ones; add an external uptime check that alerts if the heartbeat is older than 5 minutes                                |
| Free-plan 10 ms CPU cap on Cron Triggers makes the job impossible to run at $0                                                                                                    | Research finding              | H          | M      | Enable Workers Paid ($5/mo) before the first cron deploy; treat $5/mo as the baseline in any cost plan                                                                                                             |
| Cron Triggers fire late or are skipped — no timing SLA, no retry, no dead-letter                                                                                                  | Devil's advocate              | M          | M      | Make the prediction horizon tolerant: keep the 2–15 min look-ahead window wide enough that one missed tick is recoverable on the next; deduplicate by airframe so a re-detection does not double-notify            |
| `@supabase/ssr` breaks on workerd after a dependency bump (`dynamic require of stream`)                                                                                           | Devil's advocate              | M          | H      | Pin `@supabase/ssr` and `compatibility_date` exactly rather than by caret range; extend `npm run smoke` to cover an authenticated round-trip and run it against a preview version before promoting                 |
| Supabase free project pauses after 7 days of inactivity while alerts are paused, so alerts never resume                                                                           | Pre-mortem / Unknown unknowns | M          | H      | Keep the cron running even when alerts are paused (poll, evaluate, suppress the notification) so the database stays warm; or add a minimal keep-alive query independent of the pause flag                          |
| An agent follows the stale `deployment_target: cloudflare-pages` contract and runs `wrangler pages deploy`, silently producing a deploy with no cron triggers and no compat flags | Unknown unknowns              | H          | H      | Update `tech-stack.md` frontmatter to `cloudflare-workers`; record in `CLAUDE.md` that `wrangler deploy` is the only supported deploy command and `wrangler pages *` is forbidden                                  |
| Agent follows obsolete tutorials recommending `wrangler pages dev ./dist` instead of `astro dev`                                                                                  | Unknown unknowns              | M          | L      | Document in `CLAUDE.md` that `npm run dev` runs workerd via Vite and that no separate wrangler dev step exists for adapter v14                                                                                     |
| Notification channel decision (PRD Q3) is constrained by the absence of SMTP on workerd                                                                                           | Devil's advocate              | M          | M      | Prefer Telegram (one HTTPS call, no third party); if e-mail is chosen, budget for an HTTP e-mail API account and an extra secret before committing to the channel                                                  |
| Worker exceeds the 1 s global-scope startup limit as the bundle grows (e.g. the full aircraft-type list imported at module scope for FR-002 search)                               | Devil's advocate              | L          | M      | Keep the aircraft-type list in Supabase or a KV namespace and query it, rather than inlining it; watch bundle size in CI                                                                                           |
| Preview version URLs are publicly reachable and could expose a home location                                                                                                      | Research finding              | L          | H      | Put Cloudflare Access in front of preview URLs before any real user data exists; never seed previews with production data                                                                                          |
| Cloudflare MCP servers are not labelled GA and may change                                                                                                                         | Research finding              | L          | L      | Treat the CLI (`wrangler`) as the primary operational path; use MCP as a convenience, not a dependency                                                                                                             |
| Supabase migrations do not roll back with `wrangler rollback`                                                                                                                     | Research finding              | M          | M      | Write forward-compatible migrations (additive first, destructive only after the Worker no longer references the column); never pair a destructive migration with the same deploy as the code change                |

## Getting Started

These commands are verified against the versions pinned in this repository (`astro ^7.3.2`, `@astrojs/cloudflare ^14.3.1`, `wrangler ^4.131.1`), not against generic platform tutorials. The project is **Workers with Static Assets** — `wrangler pages *` commands do not apply.

1. **Authenticate and enable the paid plan.** Run `npx wrangler login`, then enable **Workers Paid ($5/mo)** in the dashboard before adding the cron — free-plan Cron Triggers are capped at 10 ms CPU and cannot run this workload.
2. **Set the secrets.** `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`. Keep the local copies in `.dev.vars` (already gitignored). These stay reachable only through `astro:env/server`.
3. **First deploy.** `npm run build && npx wrangler deploy`. Confirm with `npx wrangler deployments list`. Do **not** use `wrangler pages deploy` — it would ignore `wrangler.jsonc`, including the cron trigger added in the next step.
4. **Add the 1-minute Cron Trigger.** Add `"triggers": { "crons": ["* * * * *"] }` to `wrangler.jsonc`, export a `scheduled` handler, and redeploy. Allow up to 15 minutes for the trigger to propagate.
5. **Verify the scheduled handler locally before trusting it in production.** `npx wrangler dev --test-scheduled`, then in a second shell `curl "http://localhost:8787/__scheduled"`. A preview version will not fire the cron, so this is the only pre-production check.
6. **Watch the first live runs.** `npx wrangler tail --format pretty` and confirm the scheduled invocations appear on the minute and complete inside the CPU and subrequest budgets. Workers Logs is already enabled (`observability.enabled: true`).

**Contract fix to make first:** `context/foundation/tech-stack.md` frontmatter says `deployment_target: cloudflare-pages`. Change it to `cloudflare-workers` — `@astrojs/cloudflare` v14 removed Pages support, and leaving the stale value in the foundation contract is the highest-likelihood failure in the register above.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
