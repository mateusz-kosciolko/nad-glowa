<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Podstawowe ustawienia alertów (S-02)

- **Plan**: context/changes/alert-settings-basic/plan.md
- **Mode**: Deep
- **Date**: 2026-09-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

12/12 paths ✓, 6/6 symbols ✓ (PROTECTED_ROUTES, globalIgnores @ eslint.config.js:83, createClient callers, "Start local Supabase", spec "## Trigger" / "Domena icao_type…", deploy-plan sections), brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — authenticated keeps INSERT/DELETE through default grants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 §2 — Migracja
- **Detail**: The migration comment promises a second layer of grants, but `grant select, update … to authenticated` does not remove INSERT/DELETE, which Supabase's default privileges grant on the `public` schema. The pgTAP tests pass anyway because RLS blocks both operations, so no test catches the gap.
- **Fix**: Add `revoke all on public.alert_settings from authenticated;` before the grant in the migration. Record it in §7 as a deviation from the approved SQL.
- **Decision**: FIXED

### F2 — pgTAP trigger assertion assumes an empty database

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 §3 — Testy pgTAP; criterion 1.2
- **Detail**: `count(*) = 2` over the whole table fails once the local smoke (Faza 3) creates accounts; `npm run test:db` then fails until `db reset`.
- **Fix**: Filter the count to the two test IDs; this keeps plan(12).
- **Decision**: FIXED

### F3 — Island hydration and initial-value format not specified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 3 §1 Strona / §4 Smoke
- **Detail**: The smoke `bodyIncludes` checks require SSR of the island (`client:load`, as in signin.astro:14). The plan does not say where `aircraft_types` becomes "B744, A400".
- **Fix**: State `client:load` and `aircraft_types.join(", ")` in the Faza 3 §1 contract.
- **Decision**: FIXED

### F4 — Numeric field parsing edge cases unspecified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2 §2 — parseAlertSettingsForm
- **Detail**: `Number("")` returns 0, so the location could become 0,0 instead of null. A decimal comma ("52,23") gives NaN. The input type for lat/lon is not specified.
- **Fix**: Specify trim → empty check → replace "," with "." → `Number()` + `isFinite`; use `type="text" inputMode="decimal"`.
- **Decision**: FIXED

### F5 — The fallback path breaks assertion #8 and the "12 asercji" title

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 §2; criterion 1.2
- **Detail**: `text[]` without the domain accepts '{b744}', so test #8 fails and validation moves into the app, against the spec.
- **Fix**: In the fallback, add a CHECK on `text[]` (`array_to_string(aircraft_types, ',') ~ '^([A-Z0-9]{2,4}(,[A-Z0-9]{2,4})*)?$'`).
- **Decision**: FIXED

### F6 — Criterion 2.3 has no command to run

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 — Automated Verification
- **Detail**: The anonymous POST criterion gives no command and does not say the dev server must be running.
- **Fix**: Add a `curl … -X POST -H 'Origin: http://localhost:4321' http://localhost:4321/api/settings` command, expecting `302 …/auth/signin`.
- **Decision**: FIXED
