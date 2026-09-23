---
project: "Nad Głową"
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: null # not discussed in shaping
  data_volume: null # not discussed in shaping
timeline_budget:
  mvp_weeks: 8
  hard_deadline: 2026-12-06
  after_hours_only: true
created: 2026-09-18
updated: 2026-09-18
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "context type"
      decision: "greenfield (no project markers in cwd; confirmed by user)"
    - topic: "primary persona"
      decision: "the user themself — home-based observer; planespotters are secondary, not served in MVP"
    - topic: "notification lead time"
      decision: "2–10 minutes before the aircraft passes overhead (not merely 'currently within radius')"
    - topic: "access model"
      decision: "login required; flat model (each user sees only own rules, location, log); invite-only / whitelist sign-up"
    - topic: "MVP scope"
      decision: "scoped down: one fixed notification channel (no channel choice); origin/destination airports shown only when available, otherwise 'route unknown'; lead-time prediction and approach direction kept"
    - topic: "MVP timeline"
      decision: "~8 weeks at ~2 h/week (~16 h), remaining time to 2026-12-06 kept as buffer; sustained-effort cost acknowledged"
    - topic: "rule model"
      decision: "one rule per user in MVP = alert settings (location, radius, types) that can be changed and paused/resumed; no deletion; multiple rules nice-to-have; catch-all 'all aircraft' removed"
    - topic: "deduplication key"
      decision: "same aircraft = same airframe (transponder ICAO address / registration), regardless of callsign"
    - topic: "lead-time window"
      decision: "2–15 minutes (updated from 2–10 in phase 1)"
    - topic: "late detection (< 2 min to pass)"
      decision: "notify anyway, marked as 'already close'"
    - topic: "prediction basis"
      decision: "current heading and speed extrapolated in a straight line; wrong predictions on turns accepted for MVP"
    - topic: "altitude"
      decision: "not considered in MVP — user's radius defines visibility; aircraft on the ground are ignored"
  frs_drafted: 11
  quality_check_status: accepted
---

# Shape Notes

## Seed idea (verbatim)

> Aplikacja powiadamiająca o nietypowych samolotach (wojskowe, duże cargo typu B744/Rusłan) przelatujących w zadanym promieniu od lokalizacji użytkownika. Dane z darmowego publicznego API ADS-B, odpytywanego cyklicznie. Użytkownik definiuje reguły (lokalizacja, promień, typy, flaga wojskowa), dostaje powiadomienie jednym kanałem (bez duplikatów w oknie czasowym), a obserwacje trafiają do dziennika. Budżet: ~22 h do 6.12.2026. Otwarte pytania: które API podaje typ i flagę wojskową; kanał powiadomień (Telegram czy e-mail); długość okna deduplikacji.

## Vision & Problem Statement

A home-based aircraft watcher learns about an unusual aircraft (military, heavy cargo) only when it is already overhead — too late to step onto the balcony with binoculars. Today the only workaround is manually and irregularly checking Flightradar24 (the most-tracked list, or the map around home) "whenever I remember", so interesting flyovers are routinely missed.

Existing tools are maps that must be actively watched, not a push that arrives on its own; and "interesting" is personal — a most-tracked list reflects what interests others, not what interests this watcher over their own location. A useful alert must arrive 2–10 minutes _before_ the aircraft passes, not when it is already nearby.

Scale note: at 100× scale (hundreds of users in different cities) the domain rule stays the same — only data retrieval changes (one query area per user would exceed free data-source limits; data would need to be fetched for a wider area at once and matched per user).

Unverified assumption: existing paid alerts (e.g. Flightradar24 subscriptions) are limited or do not filter by type and home area in the way needed — not yet checked (see Open Questions).

## User & Persona

**Primary persona — home observer (the project author).** Watches aircraft from a fixed home location (balcony, binoculars). Does not monitor flight maps continuously. Reaches for the product when an unusual aircraft is about to fly over home and they want enough warning to go outside and see it.

### Secondary persona

Planespotters photographing aircraft (e.g. near airports) who need advance notice of interesting arrivals. Need longer lead times and different locations — not served in the MVP.

## MVP flow

1. User signs in.
2. User picks the aircraft types they are interested in (from a dropdown list).
3. User sets their home location.
4. (Notification channel is fixed for the MVP — no choice step.)
5. User receives a notification containing: aircraft type, registration, when it will be visible overhead, likely approach direction, and origin/destination airports when available ("route unknown" otherwise).

## Success Criteria

### Primary

- For a matching aircraft that passes within the user's radius, the notification arrives at least 2 minutes before the aircraft's closest approach to the user's home location.

### Secondary

- After a few weeks of use, the sighting log shows a history of which unusual aircraft passed over home and when.
- Origin/destination route is known in most alerts about civil aircraft.

### Guardrails

- No spam: the same aircraft does not trigger repeated notifications within the deduplication window, and false alarms are rare.
- Home location privacy: a user's home location is never visible to other users or publicly.
- A missing route never delays or blocks a notification.

## Timeline acknowledgment

Acknowledged on 2026-09-18: 8-week MVP (~2 h/week, ~16 h total) requires sustained dedication; user accepted. Remaining time before 2026-12-06 is kept as buffer.

## User Stories

### US-01: Watcher receives an advance alert

- **Given** a signed-in user whose alert settings are: home location, radius 30 km, types [A400M, B744] (example values for the test, not product decisions)
- **When** a B744 is heading toward home and will pass within 30 km
- **Then** the user receives a notification at least 2 minutes before the aircraft's closest approach, containing type, registration, predicted time, approach direction, and route (or "route unknown")

#### Acceptance Criteria

- An aircraft matching by type but passing outside the radius → no notification
- The same aircraft within the deduplication window → only one notification
- A missing route does not delay the notification

## Functional Requirements

### Access

- FR-001: An invited user can sign in. Priority: must-have
  > Socrates: Counter-argument considered: "sign-in with invitations eats a large part of a ~16 h budget for what is initially one user." Resolution: kept sign-in (protects home location), but no in-app invitation flow — allowed accounts are added manually.

### Alert settings

- FR-002: User can choose aircraft types of interest from a short list of highlighted "interesting" types with readable names, plus search across the full type list. Priority: must-have
  > Socrates: Counter-argument considered: "the full type list is huge and codes like B744/A124 are unreadable — a plain dropdown is useless." Resolution: short curated list with readable names on top, search in the full list below.
- FR-003: User can set their home location (stored only approximately, ~1 km precision). Priority: must-have
  > Socrates: Counter-argument considered: "exact home coordinates are sensitive data; km-scale alerts don't need them." Resolution: approximate location only (see NFRs).
- FR-004: User can set the watch radius (editable, with a sensible default). Priority: must-have
  > Socrates: Counter-argument considered: "a fixed radius would remove a setting the user doesn't know how to choose." Resolution: kept editable, but pre-filled with a default so no choice is required.
- FR-005: User can change their alert settings. Priority: must-have
  > Socrates: Counter-argument considered: "with a single rule, 'editing a rule' is just a settings screen, not a rule list." Resolution: reframed as changing alert settings; no rule list in MVP.
- FR-006: User can pause and resume alerts. Priority: must-have
  > Socrates: Counter-argument considered: "with a single rule, deleting it loses the settings; the user really wants to temporarily silence alerts (holiday, night)." Resolution: rule deletion replaced by pause/resume.
- FR-007: User can mark that they are interested in military aircraft. Priority: nice-to-have
  > Socrates: Counter-argument considered: "many military flights don't broadcast ADS-B or are filtered by data sources — the flag promises more than it delivers." Resolution: stays nice-to-have; when built, clearly state it covers only military aircraft visible in public data.
- FR-008: User can have several rules (different radii and types). Priority: nice-to-have
  > Socrates: Counter-argument considered: "for one watcher with one home, a second rule may never be needed." Resolution: stays nice-to-have.

### Notifications

- FR-009: User receives an advance notification about a matching aircraft containing type, registration, predicted time over home, approach direction, and route when available. Priority: must-have
  > Socrates: No counter-argument; it stands as written.
- FR-010: User does not receive a repeated notification about the same aircraft within the deduplication window. Priority: must-have
  > Socrates: Counter-argument considered: "what counts as 'the same' — the flight may change callsign." Resolution: same aircraft = same airframe (transponder address / registration), regardless of callsign.

### Sighting log

- FR-011: User can browse the sighting log. Priority: nice-to-have
  > Socrates: No counter-argument; stays nice-to-have.

Removed during challenge round: "User can choose 'all aircraft' (catch-all)" — useful mainly for testing, contradicts the "unusual aircraft" premise and the no-spam guardrail; testing can use a common type instead.

Note: after scoping, the MVP has no user-managed collection of records (single settings record; log and multiple rules are nice-to-have). User was informed; FR-008 or FR-011 are the natural candidates if full create/read/update/delete over a collection becomes necessary.

## Business Logic

Notify the user when an aircraft of a selected type is predicted to pass within their visibility radius in 2–15 minutes — once per aircraft within the deduplication window, and only while alerts are not paused.

Inputs (as the user sees them): the user's approximate home location, watch radius, and selected aircraft types; each nearby aircraft's current position, heading, speed, type and identity. The prediction assumes the aircraft keeps flying in a straight line at its current heading and speed; the closest point of that path to home decides whether it will pass within the radius and when. Wrong predictions caused by turns or approaches are accepted in the MVP. Altitude is not considered — the radius is the user's definition of visibility — and aircraft on the ground are ignored.

Output: a notification with type, registration, predicted time over home, approach direction, and route when available. If the aircraft is first detected with less than 2 minutes to its closest approach, it is still notified, marked as "already close" — the lead time is a target, not a filter. The same airframe does not trigger a second notification within the deduplication window.

## Non-Functional Requirements

- Once an aircraft in the source data starts satisfying the rule, the notification reaches the user in < 60 s.

(Home-location precision is already a requirement in FR-003 — stored only approximately, ~1 km.)

## Access Control

Login required to access the application. Flat user model — no roles, no admin: each user sees and manages only their own home location, watch rules and sighting log; no user can see another user's data. Sign-up is closed: only invited / whitelisted users can create an account (accounts are added manually — no in-app invitation flow) (protects the home location, which is sensitive, and keeps usage within free data-source limits). An unauthenticated visitor sees only the sign-in screen; any other route redirects to sign-in. Exact sign-in method (e-mail + password, OAuth, magic link) is not yet decided.

## Non-Goals

- **No own ADS-B receiver** — public data sources only; no hardware (SDR, antennas) and no feeding own data.
- **No planespotter / community features** — no shared lists, group alerts, photos, or airports as locations; the secondary persona is outside the MVP.
- **No completeness guarantee** — the product does not promise to catch every unusual aircraft (military aircraft without ADS-B, data gaps, straight-line prediction errors).
- **Deferred nice-to-haves** — military flag (FR-007), multiple rules (FR-008) and sighting log browsing (FR-011) are outside the MVP.
- **No choice of notification channel** — one fixed channel in the MVP.

## Forward: tech-stack

Informational, not part of the PRD schema — for the tech-stack selection step:

- Author's background: ~10 years backend (Java, some Python) and AWS; new to agent-assisted development (Claude Code).
- Notification channel candidates: Telegram or e-mail (see Open Questions).
- Data source candidates to evaluate: free public ADS-B APIs (e.g. OpenSky Network, adsb.lol, airplanes.live) — must provide aircraft type; route lookup by callsign is a separate, optional source.

## Quality cross-check

Run on 2026-09-18 — all items present (Access Control, Business Logic, project artifacts, timeline-cost acknowledgment, Non-Goals; preserved behavior n/a for greenfield). Status: accepted.

## Open Questions (running)

1. **Do existing paid alerts (Flightradar24 or similar) already solve this?** — Owner: user. Unverified; check before building.
2. **Which free public ADS-B API provides aircraft type and a military flag?** — Owner: user. From seed idea.
3. **Notification channel: Telegram or e-mail?** — Owner: user. From seed idea.
4. **Length of the deduplication window?** — Owner: user. From seed idea.
5. **Sign-in method (e-mail + password, OAuth, magic link)?** — Owner: user. Not decided in shaping.
6. **Default watch radius value?** — Owner: user. FR-004 requires a sensible default.
