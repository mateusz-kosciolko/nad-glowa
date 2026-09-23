---
project: "Nad Głową"
version: 1
status: draft
created: 2026-09-21
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: null # not discussed in shaping — see Open Questions
  data_volume: null # not discussed in shaping — see Open Questions
timeline_budget:
  mvp_weeks: 8
  hard_deadline: 2026-12-06
  after_hours_only: true
---

# Nad Głową — Product Requirements

## Vision & Problem Statement

A home-based aircraft watcher learns about an unusual aircraft (military, heavy cargo) only when it is already overhead — too late to step onto the balcony with binoculars. Today the only workaround is manually and irregularly checking Flightradar24 (the most-tracked list, or the map around home) "whenever I remember", so interesting flyovers are routinely missed.

Existing tools are maps that must be actively watched, not a push that arrives on its own; and "interesting" is personal — a most-tracked list reflects what interests others, not what interests this watcher over their own location. A useful alert must arrive 2–15 minutes _before_ the aircraft passes, not when it is already nearby.

## User & Persona

**Primary persona — home observer (the project author).** Watches aircraft from a fixed home location (balcony, binoculars). Does not monitor flight maps continuously. Reaches for the product when an unusual aircraft is about to fly over home and they want enough warning to go outside and see it.

### Secondary persona

Planespotters photographing aircraft (e.g. near airports) who need advance notice of interesting arrivals. Need longer lead times and different locations — not served in the MVP.

## Success Criteria

### Primary

- For a matching aircraft that passes within the user's radius, the notification arrives at least 2 minutes before the aircraft's closest approach to the user's home location.

### Secondary

- After a few weeks of use, the sighting log shows a history of which unusual aircraft passed over home and when. (Depends on the sighting log, which is nice-to-have — see Open Questions.)
- Origin/destination route is known in most alerts about civil aircraft.

### Guardrails

- No spam: the same aircraft does not trigger repeated notifications within the deduplication window, and false alarms are rare.
- Home location privacy: a user's home location is never visible to other users or publicly.
- A missing route never delays or blocks a notification.

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

## Non-Functional Requirements

- Once an aircraft in the source data starts satisfying the rule, the notification reaches the user in < 60 s.

(Home-location precision is already a requirement in FR-003 — stored only approximately, ~1 km.)

## Business Logic

Notify the user when an aircraft of a selected type is predicted to pass within their visibility radius in 2–15 minutes — once per aircraft within the deduplication window, and only while alerts are not paused.

Inputs (as the user sees them): the user's approximate home location, watch radius, and selected aircraft types; each nearby aircraft's current position, heading, speed, type and identity. The prediction assumes the aircraft keeps flying in a straight line at its current heading and speed; the closest point of that path to home decides whether it will pass within the radius and when. Wrong predictions caused by turns or approaches are accepted in the MVP. Altitude is not considered — the radius is the user's definition of visibility — and aircraft on the ground are ignored.

Output: a notification with type, registration, predicted time over home, approach direction, and route when available. If the aircraft is first detected with less than 2 minutes to its closest approach, it is still notified, marked as "already close" — the lead time is a target, not a filter. The same airframe does not trigger a second notification within the deduplication window.

## Access Control

Login required to access the application. Flat user model — no roles, no admin: each user sees and manages only their own home location, watch rules and sighting log; no user can see another user's data. Sign-up is closed: only invited / whitelisted users can create an account (accounts are added manually — no in-app invitation flow) (protects the home location, which is sensitive, and keeps usage within free data-source limits). An unauthenticated visitor sees only the sign-in screen; any other route redirects to sign-in. Exact sign-in method is not yet decided — see Open Questions.

## Non-Goals

- **No own ADS-B receiver** — public data sources only; no hardware (SDR, antennas) and no feeding own data.
- **No planespotter / community features** — no shared lists, group alerts, photos, or airports as locations; the secondary persona is outside the MVP.
- **No completeness guarantee** — the product does not promise to catch every unusual aircraft (military aircraft without ADS-B, data gaps, straight-line prediction errors).
- **Deferred nice-to-haves** — military flag (FR-007), multiple rules (FR-008) and sighting log browsing (FR-011) are outside the MVP.
- **No choice of notification channel** — one fixed channel in the MVP.
- **No "all aircraft" mode** — removed during shaping; it contradicts the "unusual aircraft" premise and the no-spam guardrail.

## Open Questions

1. **Do existing paid alerts (Flightradar24 or similar) already solve this?** — Owner: user. Unverified assumption; check before building.
2. **Which free public ADS-B data source provides aircraft type and a military flag?** — Owner: user. Block: yes for FR-002/FR-009 — without aircraft type in the data the business rule cannot run.
3. **Notification channel: Telegram or e-mail?** — Owner: user.
4. **Length of the deduplication window?** — Owner: user. Needed for FR-010.
5. **Sign-in method (e-mail + password, OAuth, magic link)?** — Owner: user. Needed for FR-001.
6. **Default watch radius value?** — Owner: user. FR-004 requires a sensible default.
7. **Target scale: expected request volume (`qps`) and data volume (`data_volume`)?** — Owner: user. Not discussed in shaping; frontmatter left as `null`.
8. **Is the sighting log recorded in the MVP even though browsing it (FR-011) is nice-to-have?** — Owner: user. The Secondary success criterion ("the sighting log shows a history…") depends on it.
9. **Should the MVP include a user-managed collection of records?** — Owner: user. After scoping, the MVP has a single settings record only; FR-008 (multiple rules) or FR-011 (sighting log, e.g. with removing entries) are the natural candidates if full create/read/update/delete over a collection becomes necessary.
