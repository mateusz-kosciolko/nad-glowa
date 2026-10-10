// Risk #1 (test plan §2): a matching aircraft must produce exactly one correct alert, and every reported failure
// must be visible in the run trace. The poller runs for real; only the edges are faked (see poller-fakes.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeRunOutcome } from "@/lib/cron-runs";
import { runAlertPoll } from "@/workers/alert-poller";
import {
  ADSB_HOST,
  alertUser,
  createFakeSupabase,
  DEFAULT_CHAT_ID,
  DEFAULT_USER_ID,
  feedEntry,
  feedReply,
  HOME,
  installFetchFake,
  jsonReply,
  NOW,
  postgrestError,
  telegramError,
  TELEGRAM_HOST,
  TOKEN,
  type FakeReply,
  type FakeSupabase,
  type FeedOverrides,
  type FetchFake,
  type RawFeedEntry,
} from "@/workers/poller-fakes";

// Geometry of every "matching" fixture, computed independently of predictPass: due north of home, heading south
// (track 180) at 360 kt = 0.1852 km/s, so 600 s away means 111.12 km. 111.12 km / 6371 km rad ≈ 0.99933°; the
// latitude is rounded up to 0.9994° (≈111.128 km, ≈600.04 s) so the pass never lands a hair before 12:10:00Z.
// Expected: "~10 min", clock 14:10 Warsaw (CEST), approaching from N, closest pass 0.0 km (straight over home).
const MATCHING_POSITION = { lat: HOME.lat + 0.9994, lon: HOME.lon, track: 180, gs: 360, seen_pos: 0 };

function matchingAircraft(overrides: FeedOverrides = {}): RawFeedEntry {
  return feedEntry({ ...MATCHING_POSITION, hex: "48af01", t: "B738", r: "SP-LWA", flight: "LOT3", ...overrides });
}

const SECOND_USER = alertUser({ user_id: "00000000-0000-4000-8000-000000000002", telegram_chat_id: 222222222 });

let http: FetchFake;

beforeEach(() => {
  http = installFetchFake();
});

afterEach(() => {
  const unexpected = [...http.unexpected];
  vi.unstubAllGlobals();
  expect(unexpected, "requests to hosts without a fake (a new hidden dependency?)").toEqual([]);
});

function seedDatabase(settings = [alertUser()]): FakeSupabase {
  return createFakeSupabase({ clock: () => NOW, settings });
}

// Error strings reach cron_runs.error and the log; alert-poller.ts promises they never carry the bot token, chat IDs
// or home coordinates.
function expectNoSecretsIn(errors: readonly string[]): void {
  const text = errors.join("\n");
  const secrets = [
    TOKEN,
    String(DEFAULT_CHAT_ID),
    String(SECOND_USER.telegram_chat_id),
    String(HOME.lat),
    String(HOME.lon),
  ];
  for (const secret of secrets) {
    expect(text, `run errors must not contain "${secret}"`).not.toContain(secret);
  }
}

describe("risk #1: one matching aircraft gives exactly one alert", () => {
  it("sends one correct alert and records it, ignoring another type on the same track", async () => {
    const db = seedDatabase();
    http.adsb = feedReply([matchingAircraft(), matchingAircraft({ hex: "4b1801", t: "A320", r: "HB-JLT" })]);

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    const messages = http.telegramMessages();
    expect(messages, "Telegram sendMessage requests").toHaveLength(1);
    const [message] = messages;
    expect(message.chat_id, "chat_id of the alert").toBe(DEFAULT_CHAT_ID);
    const text = String(message.text);
    expect(text).toContain("B738 · SP-LWA");
    expect(text).toContain("~10 min (14:10)");
    expect(text).toContain("Approaching from N");
    expect(text).toContain("closest pass 0.0 km");
    expect(text).toContain("Route unknown");
    expect(text).toContain("globe.adsb.fi/?icao=48af01");
    expect(text, "the A320 on the same track must not be alerted").not.toContain("A320");

    expect(summary.sent).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(describeRunOutcome(summary).status).toBe("ok");

    expect(db.notifications, "recorded alert_notifications rows").toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({
      user_id: DEFAULT_USER_ID,
      aircraft_hex: "48af01",
      registration: "SP-LWA",
      aircraft_type: "B738",
      already_close: false,
      sent_at: NOW.toISOString(),
    });
  });
});

describe("risk #1: type matching", () => {
  it.each<[string, RawFeedEntry, string[], number]>([
    ["lowercase feed type meets an uppercase user type", matchingAircraft({ t: "b738" }), ["B738"], 1],
    ["user watches another type", matchingAircraft(), ["A320"], 0],
    ["feed entry without a type", matchingAircraft({ t: undefined }), ["B738"], 0],
  ])("%s", async (_label, aircraft, types, expectedSends) => {
    const db = seedDatabase([alertUser({ aircraft_types: types })]);
    http.adsb = feedReply([aircraft]);

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage requests").toHaveLength(expectedSends);
    expect(summary.matches).toBe(expectedSends);
    expect(summary.sent).toBe(expectedSends);
    expect(summary.errors).toEqual([]);
    expect(db.notifications).toHaveLength(expectedSends);
  });
});

interface FailureCase {
  label: string;
  token?: string | undefined;
  users?: number;
  adsb?: FakeReply;
  telegram?: FakeReply[];
  inject?: (db: FakeSupabase) => void;
  fragment: string;
  sends: number;
  adsbRequests?: number;
  notificationRows?: number;
}

const FAILURES: FailureCase[] = [
  { label: "missing bot token", token: undefined, fragment: "TELEGRAM_BOT_TOKEN is not configured", sends: 0 },
  {
    label: "alert settings read fails",
    inject: (db) => (db.settingsError = postgrestError("permission denied for table alert_settings")),
    fragment: "reading alert settings failed",
    sends: 0,
  },
  { label: "ADS-B answers 503", adsb: jsonReply(503, { error: "unavailable" }), fragment: "HTTP 503", sends: 0 },
  {
    label: "ADS-B body is not JSON",
    adsb: { status: 200, body: "<html>maintenance</html>" },
    fragment: "not valid JSON",
    sends: 0,
  },
  { label: "ADS-B JSON without ac", adsb: jsonReply(200, {}), fragment: 'without an "ac" array', sends: 0 },
  {
    label: "ADS-B answers 429 with two users",
    users: 2,
    adsb: jsonReply(429, { error: "rate limited" }),
    fragment: "polling stopped for the remaining users",
    sends: 0,
    adsbRequests: 1,
  },
  {
    label: "recent alerts read fails",
    inject: (db) => (db.recentError = postgrestError("permission denied for table alert_notifications")),
    fragment: "reading recent alerts failed",
    sends: 0,
  },
  {
    label: "Telegram answers 500",
    telegram: [telegramError(500, "Internal Server Error")],
    fragment: "Telegram send failed",
    sends: 1,
    notificationRows: 0,
  },
  {
    label: "insert fails after a successful send",
    inject: (db) => (db.insertError = postgrestError("permission denied for table alert_notifications")),
    fragment: "alert sent but not recorded",
    sends: 1,
    notificationRows: 0,
  },
];

describe("risk #1: a reported failure is visible in the run trace", () => {
  it.each(FAILURES.map((failure) => [failure.label, failure] as const))("%s", async (_label, failure) => {
    const db = seedDatabase(failure.users === 2 ? [alertUser(), SECOND_USER] : [alertUser()]);
    failure.inject?.(db);
    http.adsb = failure.adsb ?? feedReply([matchingAircraft()]);
    http.telegram = [...(failure.telegram ?? [])];
    const token = "token" in failure ? failure.token : TOKEN;

    const summary = await runAlertPoll(db.client, () => NOW, token);

    expect(summary.errors.join("\n"), "run errors").toContain(failure.fragment);
    expectNoSecretsIn(summary.errors);
    expect(describeRunOutcome(summary).status, "run status stored in cron_runs").toBe("error");
    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage attempts").toHaveLength(failure.sends);
    if (failure.token === undefined && "token" in failure) {
      expect(http.requests, "no HTTP request at all without a token").toEqual([]);
    }
    if (failure.adsbRequests !== undefined) {
      expect(http.requestsTo(ADSB_HOST), "ADS-B requests").toHaveLength(failure.adsbRequests);
    }
    if (failure.notificationRows !== undefined) {
      expect(db.notifications, "recorded alert_notifications rows").toHaveLength(failure.notificationRows);
    }
  });
});

// Risk #2 (test plan §2): the same airframe must not be alerted to the same user again within 60 minutes, and a
// failed send must not be repeated for every candidate in the same run.

const MINUTE_MS = 60_000;

// A second B738 on the same approach line, closer in: 0.95° north ≈ 105.6 km, at 0.1852 km/s ≈ 570 s away, which is
// inside the 15-min horizon and passes straight over home. Different hex and registration, so it is another airframe.
function secondMatchingAircraft(): RawFeedEntry {
  return matchingAircraft({ lat: HOME.lat + 0.95, hex: "48af02", r: "SP-LWC", flight: "LOT5" });
}

// An alert_notifications row as an earlier run would have stored it for the default matching aircraft.
function earlierAlert(userId: string, sentAt: Date) {
  return {
    user_id: userId,
    aircraft_hex: "48af01",
    registration: "SP-LWA",
    aircraft_type: "B738",
    already_close: false,
    closest_at: new Date(sentAt.getTime() + 10 * MINUTE_MS).toISOString(),
    closest_distance_km: 0,
    sent_at: sentAt.toISOString(),
  };
}

describe("risk #2: no repeat for the same airframe within the window", () => {
  it.each<[string, FeedOverrides, number]>([
    ["same hex, new callsign LOT9 → blocked", { flight: "LOT9" }, 0],
    ["new hex 48af99, same registration SP-LWA → blocked", { hex: "48af99" }, 0],
    ["control: new hex 48af99 and registration SP-LWB → sent", { hex: "48af99", r: "SP-LWB" }, 1],
  ])("run 2 one minute later: %s", async (_label, run2Overrides, expectedRun2Sends) => {
    let clock = NOW;
    const db = createFakeSupabase({ clock: () => clock, settings: [alertUser()] });

    http.adsb = feedReply([matchingAircraft()]);
    const run1 = await runAlertPoll(db.client, () => clock, TOKEN);
    expect(run1.sent, "run 1 sends for 48af01 / SP-LWA / LOT3").toBe(1);
    expect(db.notifications, "rows after run 1").toHaveLength(1);

    clock = new Date(NOW.getTime() + MINUTE_MS);
    const run1Requests = http.requestsTo(TELEGRAM_HOST).length;
    http.adsb = feedReply([matchingAircraft(run2Overrides)]);
    const run2 = await runAlertPoll(db.client, () => clock, TOKEN);

    expect(http.requestsTo(TELEGRAM_HOST).length - run1Requests, "Telegram requests in run 2").toBe(expectedRun2Sends);
    expect(run2.sent, "run 2 sent").toBe(expectedRun2Sends);
    expect(run2.duplicates, "run 2 duplicates").toBe(1 - expectedRun2Sends);
    expect(run2.errors, "run 2 errors").toEqual([]);
    expect(db.notifications, "rows after run 2").toHaveLength(1 + expectedRun2Sends);
  });

  it.each<[string, number, number]>([
    ["alerted 59 min ago → still blocked", 59, 0],
    ["alerted 61 min ago → outside the 60-min window, sent", 61, 1],
  ])("same hex %s", async (_label, minutesAgo, expectedSends) => {
    const db = createFakeSupabase({
      clock: () => NOW,
      settings: [alertUser()],
      notifications: [earlierAlert(DEFAULT_USER_ID, new Date(NOW.getTime() - minutesAgo * MINUTE_MS))],
    });
    http.adsb = feedReply([matchingAircraft()]);

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage requests").toHaveLength(expectedSends);
    expect(summary.sent, "sent").toBe(expectedSends);
    expect(summary.duplicates, "duplicates").toBe(1 - expectedSends);
    expect(summary.errors, "run errors").toEqual([]);
    expect(db.notifications, "rows after the run (seeded + new)").toHaveLength(1 + expectedSends);
  });

  it("is per user: one user's recent alert does not silence another user at the same home", async () => {
    const db = createFakeSupabase({
      clock: () => NOW,
      settings: [alertUser(), SECOND_USER],
      notifications: [earlierAlert(DEFAULT_USER_ID, new Date(NOW.getTime() - 10 * MINUTE_MS))],
    });
    http.adsb = feedReply([matchingAircraft()]);

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(
      http.telegramMessages().map((message) => message.chat_id),
      "chats that received an alert (only the second user's)",
    ).toEqual([SECOND_USER.telegram_chat_id]);
    expect(summary.sent, "sent").toBe(1);
    expect(summary.duplicates, "duplicates (the first user's)").toBe(1);
    expect(summary.errors, "run errors").toEqual([]);
    const newRows = db.notifications.filter((row) => row.sent_at === NOW.toISOString());
    expect(
      newRows.map((row) => row.user_id),
      "users with a new alert row",
    ).toEqual([SECOND_USER.user_id]);
  });
});

describe("risk #2: failed sends are limited per run", () => {
  it.each<[string, FakeReply, number]>([
    ["400 chat not found → stop for this chat", telegramError(400, "Bad Request: chat not found"), 1],
    ["403 bot blocked → stop for this chat", telegramError(403, "Forbidden: bot was blocked by the user"), 1],
    ["500 (contrast) → every candidate is tried", telegramError(500, "Internal Server Error"), 2],
  ])("Telegram %s", async (_label, reply, expectedAttempts) => {
    const db = seedDatabase();
    http.adsb = feedReply([matchingAircraft(), secondMatchingAircraft()]);
    http.telegram = [reply, reply];
    const description = (JSON.parse(reply.body) as { description: string }).description;

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(summary.matches, "matching candidates for the user").toBe(2);
    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage attempts").toHaveLength(expectedAttempts);
    const failures = summary.errors.filter((error) => error.includes(description));
    expect(failures, `run errors carrying "${description}"`).toHaveLength(expectedAttempts);
    expectNoSecretsIn(summary.errors);
    expect(summary.sent, "sent").toBe(0);
    expect(db.notifications, "recorded alert_notifications rows").toEqual([]);
  });

  it("429 stops the run for the remaining users and names them in the trace", async () => {
    const db = seedDatabase([alertUser(), SECOND_USER]);
    http.adsb = feedReply([matchingAircraft()]);
    http.telegram = [telegramError(429, "Too Many Requests: retry after 30")];

    const summary = await runAlertPoll(db.client, () => NOW, TOKEN);

    expect(http.requestsTo(TELEGRAM_HOST), "Telegram sendMessage attempts").toHaveLength(1);
    expect(http.requestsTo(ADSB_HOST), "ADS-B requests (none for the skipped user)").toHaveLength(1);
    expect(summary.errors.join("\n"), "run errors").toContain("Telegram rate limit hit; 1 user(s) skipped in this run");
    expectNoSecretsIn(summary.errors);
    expect(summary.sent, "sent").toBe(0);
    expect(db.notifications, "recorded alert_notifications rows").toEqual([]);
  });
});
