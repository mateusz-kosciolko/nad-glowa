<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Zweryfikowane źródło danych ADS-B (F-01)

- **Plan**: context/changes/adsb-source-verified/plan.md
- **Mode**: Deep
- **Date**: 2026-09-28
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

10/10 paths ✓, 5/5 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (3/3 phases, 14/14 criteria), external claims 12/12 ✓ (adsb.fi, adsb.lol, readsb JSON, Cloudflare Workers Free limits)

## Findings

### F1 — The automated check in 1.2 runs for ~27 minutes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria / Progress 1.2
- **Detail**: With the defaults (6 samples × 300 s plus adsbdb lookups), the measurement exceeds the agent's 10-minute command limit, so /10x-implement cannot run it as an automated check.
- **Fix**: 1.2 becomes a quick run (`SAMPLES=1 ROUTE_LOOKUPS=3`). The full measurement moves to manual step 1.3.
- **Decision**: FIXED

### F2 — Attribution is hard-coded to adsb.fi

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 2 §5
- **Detail**: The contingency switch to adsb.lol leaves the footer showing adsb.fi. ODbL §4.3 also requires a notice. The footer sits below the first screen and without `bg-cosmic`.
- **Fix**: The footer renders from `ADSB_SOURCES[DEFAULT_ADSB_SOURCE]`, has its own background or colour, and the contingency rule mentions it.
- **Decision**: FIXED

### F3 — The gate threshold does not say which source or how to aggregate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Manual Verification (1.3)
- **Detail**: The plan does not say whether the threshold is summed over all samples or checked in each one, whether both sources must pass, or what happens when the fallback fails.
- **Fix**: Summed over all samples per source. The gate applies to adsb.fi. A fallback miss is recorded as a risk.
- **Decision**: FIXED

### F4 — The probe contract does not handle a Supabase query error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2 — Endpoint sondy
- **Detail**: The `error` from `.maybeSingle()` has no specified response.
- **Fix**: `error` → 500 `{ error: error.message }`.
- **Decision**: FIXED

### F5 — Open Question 2 also asks about the military flag

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2 — Dokument decyzji
- **Detail**: Q2 asks about the type AND the military flag. The decision document did not answer the second half.
- **Fix**: A "Flaga wojskowa" section in adsb-source.md.
- **Decision**: FIXED

### F6 — `hex` with a `~` prefix is not an ICAO address

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 — AircraftState.hex
- **Detail**: readsb marks non-ICAO addresses (TIS-B) with `~`. They are not a stable dedup key.
- **Fix**: Correct the comment, have the script count `~` entries, and add a note to the S-03/S-04 guidance.
- **Decision**: FIXED
