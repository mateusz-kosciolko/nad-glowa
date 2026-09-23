---
bootstrapped_at: 2026-09-22T08:23:39Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: nad-glowa
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: nad-glowa
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
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
```

### Why this stack

A solo developer working after hours with an 8-week budget and a hard deadline needs an agent-friendly starter that ships auth, a database and deployment out of the box, so the limited time goes into the core alert logic rather than plumbing. Astro+Supabase+Cloudflare is the recommended default for a JS web app and clears all four agent-friendly gates. Supabase Auth covers closed, invite-only sign-in with manually added accounts, and Postgres row-level security enforces the rule that each user sees only their own approximate home location and settings. The load-bearing concern is the background job that polls a public ADS-B source, predicts closest approach and sends notifications; it runs as a Cloudflare Cron Trigger every minute, which fits the under-60-second notification requirement because the prediction horizon is 2–15 minutes ahead. The starter's edge-runtime limit on long-running tasks was accepted knowingly; a separate worker (e.g. on Fly) is the escape hatch if sub-minute polling is ever needed. Payments, realtime and AI are out of scope per the PRD. CI runs on GitHub Actions with auto-deploy on merge; bootstrapper confidence is first-class, so expect an occasional manual step.

## Pre-scaffold verification

| Signal      | Value                                                               | Severity | Notes                                                                      |
| ----------- | ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| npm package | not run                                                             | —        | cmd_template starts with `git clone`; no create-* CLI to resolve           |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12T21:16:08Z | fresh    | from card.docs_url (https://github.com/przeprogramowani/10x-astro-starter) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Environment override (user request)**: `npm_config_registry=https://registry.npmjs.org/` exported for all npm invocations (the cwd `.npmrc` with the same value does not apply inside `.bootstrap-scaffold/`). Verified: all 804 `resolved` URLs in `package-lock.json` point at `registry.npmjs.org`.
**Strategy**: git-clone (cloned `.git/` deleted before move-up)
**Exit code**: 0 (npm: added 656 packages, audited 657 packages in 35s)
**Files moved**: 22 top-level entries — .env.example, .github, .gitignore, .husky, .nvmrc, .prettierrc.json, .vscode, AGENTS.md, README.md, astro.config.mjs, components.json, eslint.config.js, node_modules, package-lock.json, package.json, public, scripts, src, supabase, tsconfig.json, wrangler.jsonc, CLAUDE.md (as sibling)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold
**.gitignore handling**: moved silently (absent in cwd)
**context/ handling**: scaffold shipped no `context/`; cwd `context/` untouched
**.bootstrap-scaffold cleanup**: deleted

**Install warnings (stderr)**: `EBADENGINE` — local Node is v22.16.0, but `astro-eslint-parser@3.1.0` and `eslint-plugin-astro@3.1.0` require `^22.22.3 || ^24.16.0 || >=26.3.0`, and `undici@8.10.2` requires `>=22.19.0`. The starter's `.nvmrc` pins 22.14.0, which is also below these ranges. Install succeeded; runtime/lint issues possible until Node is upgraded.

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW (0 INFO)
**Direct vs transitive**: 0/0/0/0 direct of total 0/0/0/0
**Dependency counts**: 804 total (prod 377, dev 269, optional 167)

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

None.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | true                 |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
- Upgrade local Node to ≥ 22.22.3 (or 24.16+) and bump `.nvmrc` accordingly to clear the EBADENGINE warnings.
