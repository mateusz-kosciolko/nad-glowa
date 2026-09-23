---
starter_id: 10x-astro-starter
package_manager: npm
project_name: nad-glowa
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

A solo developer working after hours with an 8-week budget and a hard deadline needs an agent-friendly starter that ships auth, a database and deployment out of the box, so the limited time goes into the core alert logic rather than plumbing. Astro+Supabase+Cloudflare is the recommended default for a JS web app and clears all four agent-friendly gates. Supabase Auth covers closed, invite-only sign-in with manually added accounts, and Postgres row-level security enforces the rule that each user sees only their own approximate home location and settings. The load-bearing concern is the background job that polls a public ADS-B source, predicts closest approach and sends notifications; it runs as a Cloudflare Cron Trigger every minute, which fits the under-60-second notification requirement because the prediction horizon is 2–15 minutes ahead. The starter's edge-runtime limit on long-running tasks was accepted knowingly; a separate worker (e.g. on Fly) is the escape hatch if sub-minute polling is ever needed. Payments, realtime and AI are out of scope per the PRD. CI runs on GitHub Actions with auto-deploy on merge; bootstrapper confidence is first-class, so expect an occasional manual step.
