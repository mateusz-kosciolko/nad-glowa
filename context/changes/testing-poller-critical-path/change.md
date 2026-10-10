---
change_id: testing-poller-critical-path
title: Test rollout phase 1 — poller critical path (one alert, no repeat, match boundaries)
status: implemented
created: 2026-10-09
updated: 2026-10-10
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Poller critical path".
Risks covered: #1 (matching aircraft passes, no alert, run trace indistinguishable from empty sky), #2 (same airframe re-alerted within the 60-min window), #4 (match rule wrong at boundaries: radius, <2 min "already close", 2–15 min horizon). Test types planned: integration (fake external edges) + unit (boundary table).
Risk response intent:

- #1: prove that a run with a matching aircraft sends exactly one notification, and a failed fetch/send leaves an error in the run trace instead of looking like an empty run.
- #2: prove that a second run with the same airframe (different callsign, same registration or address) sends nothing, and a permanent send error does not produce a new attempt every minute.
- #4: prove PRD boundary cases (just outside radius, <2 min, >15 min, on ground) give the expected decision, with an oracle independent of the implementation.
  After creating the folder, follow the downstream continuation rule.
