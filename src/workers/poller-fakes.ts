// Edge fakes for the alert poller's integration tests (imported only by *.integration.test.ts). Only the external
// boundaries are faked: outbound HTTP (adsb.fi, adsbdb, Telegram) and the Supabase client. The real feed parser,
// HTTP clients, prediction, dedup and message formatting run unchanged.
// The Supabase fake implements generic query semantics over stored rows; it knows nothing about what the poller
// expects, so dedup and recording are proven by the rows it ends up holding.
import { PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { Database } from "@/db/database.types";

type Tables = Database["public"]["Tables"];
export type AlertSettingsRow = Tables["alert_settings"]["Row"];
export type AlertNotificationRow = Tables["alert_notifications"]["Row"];

// --- Fixture constants --------------------------------------------------------------------------------------------

// 14:00 in Warsaw: on 2026-10-10 Poland is on CEST (UTC+2).
export const NOW = new Date("2026-10-10T12:00:00Z");
export const TOKEN = "123456:fake-bot-token";

// Warsaw city centre.
export const HOME = { lat: 52.2297, lon: 21.0122 };
export const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_CHAT_ID = 111111111;

// One active user at HOME watching B738 within 10 km. Overrides build further users.
export function alertUser(overrides: Partial<AlertSettingsRow> = {}): AlertSettingsRow {
  return {
    user_id: DEFAULT_USER_ID,
    home_lat: HOME.lat,
    home_lon: HOME.lon,
    radius_km: 10,
    aircraft_types: ["B738"],
    telegram_chat_id: DEFAULT_CHAT_ID,
    paused: false,
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

// --- Raw ADS-B feed -----------------------------------------------------------------------------------------------

// The adsb.fi v3 entry fields the poller reads, in the feed's own names and units (gs in knots, alt_baro in feet or
// the string "ground", seen_pos in seconds). A value set to undefined is left out of the JSON body.
export interface RawFeedEntry {
  hex?: string;
  t?: string;
  r?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  track?: number;
  gs?: number;
  alt_baro?: number | "ground";
  seen_pos?: number;
  dbFlags?: number;
}

export type FeedOverrides = { [K in keyof RawFeedEntry]?: RawFeedEntry[K] | undefined };

// An airborne aircraft with a fresh position, by default at HOME heading north. Callers set the position, track and
// speed that their scenario's geometry needs.
export function feedEntry(overrides: FeedOverrides = {}): RawFeedEntry {
  return {
    hex: "48af01",
    t: "B738",
    r: "SP-LWA",
    flight: "LOT3",
    lat: HOME.lat,
    lon: HOME.lon,
    track: 0,
    gs: 300,
    alt_baro: 36000,
    seen_pos: 0,
    ...overrides,
  };
}

// --- Fake HTTP edge -----------------------------------------------------------------------------------------------

export interface FakeReply {
  status: number;
  // Raw body text, so a reply can also be malformed JSON.
  body: string;
}

export function jsonReply(status: number, value: unknown): FakeReply {
  return { status, body: JSON.stringify(value) };
}

export function feedReply(entries: RawFeedEntry[]): FakeReply {
  return jsonReply(200, { ac: entries });
}

// Telegram Bot API shapes: success is HTTP 2xx with ok: true; failures carry a description.
export function telegramOk(): FakeReply {
  return jsonReply(200, { ok: true, result: {} });
}

export function telegramError(status: number, description: string): FakeReply {
  return jsonReply(status, { ok: false, error_code: status, description });
}

export const ADSB_HOST = "opendata.adsb.fi";
export const ROUTE_HOST = "api.adsbdb.com";
export const TELEGRAM_HOST = "api.telegram.org";

export interface RecordedRequest {
  host: string;
  path: string;
  method: string;
  // Parsed JSON request body, or null when there was none.
  body: unknown;
}

export interface FetchFake {
  // Every request, in order, including ones to unknown hosts.
  readonly requests: RecordedRequest[];
  // Answer to every adsb.fi request; replace it between runs to change the sky.
  adsb: FakeReply;
  // Answer to every adsbdb request; the default 404 means "route unknown".
  route: FakeReply;
  // Telegram answers in order; once empty, every send succeeds.
  telegram: FakeReply[];
  requestsTo(host: string): RecordedRequest[];
  // Telegram sendMessage bodies, in order.
  telegramMessages(): { chat_id: unknown; text: unknown }[];
  // Requests to hosts the fakes do not know. The clients swallow network errors, so a throw alone would go
  // unnoticed; tests check this list after each case.
  readonly unexpected: string[];
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function toResponse(reply: FakeReply): Response {
  return new Response(reply.body, { status: reply.status, headers: { "Content-Type": "application/json" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Replaces the global fetch until vi.unstubAllGlobals() (call it in afterEach).
export function installFetchFake(): FetchFake {
  const fake: FetchFake = {
    requests: [],
    adsb: feedReply([]),
    route: jsonReply(404, { response: "unknown callsign" }),
    telegram: [],
    unexpected: [],
    requestsTo: (host) => fake.requests.filter((request) => request.host === host),
    telegramMessages: () =>
      fake.requestsTo(TELEGRAM_HOST).map(({ body }) => ({
        chat_id: isRecord(body) ? body.chat_id : undefined,
        text: isRecord(body) ? body.text : undefined,
      })),
  };

  const stub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    fake.requests.push({
      host: url.host,
      path: url.pathname,
      method: init?.method ?? "GET",
      body: parseBody(init?.body),
    });
    switch (url.host) {
      case ADSB_HOST:
        return Promise.resolve(toResponse(fake.adsb));
      case ROUTE_HOST:
        return Promise.resolve(toResponse(fake.route));
      case TELEGRAM_HOST:
        return Promise.resolve(toResponse(fake.telegram.shift() ?? telegramOk()));
      default:
        fake.unexpected.push(url.host);
        return Promise.reject(new Error(`Unexpected request to ${url.host}: no fake for this host`));
    }
  };
  vi.stubGlobal("fetch", stub);
  return fake;
}

// --- Fake Supabase ------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null } | { data: null; error: PostgrestError };
type Filter = (row: Row) => boolean;

// An error as PostgREST reports it, e.g. postgrestError("permission denied for table alert_settings").
export function postgrestError(message: string): PostgrestError {
  return new PostgrestError({ message, details: "", hint: "", code: "XX000" });
}

// Compares two stored values the way Postgres orders them for the types in play: numbers numerically, ISO
// timestamps (all in UTC "Z" form here) and other strings lexicographically.
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  throw new Error(`Fake Supabase cannot compare ${typeof a} with ${typeof b}`);
}

class FakeSelect implements PromiseLike<QueryResult> {
  private readonly filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(
    private readonly rows: () => Row[],
    private readonly columns: string[],
    private readonly error: () => PostgrestError | null,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== "is" || value !== null) {
      throw new Error(`Fake Supabase supports only not(column, "is", null), got not(${column}, ${operator}, …)`);
    }
    this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  private execute(): QueryResult {
    const error = this.error();
    if (error) {
      return { data: null, error };
    }
    const matching = this.rows().filter((row) => this.filters.every((filter) => filter(row)));
    const { orderBy } = this;
    if (orderBy) {
      matching.sort((a, b) => compare(a[orderBy.column], b[orderBy.column]) * (orderBy.ascending ? 1 : -1));
    }
    const data = matching.map((row) => Object.fromEntries(this.columns.map((column) => [column, row[column]])));
    return { data, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabaseOptions {
  // The database's now(), used as the default for sent_at.
  clock: () => Date;
  settings?: AlertSettingsRow[];
  // Seeded rows, e.g. alerts sent by an earlier run. id and sent_at are filled when missing.
  notifications?: (Omit<AlertNotificationRow, "id" | "sent_at"> & { id?: number; sent_at?: string })[];
}

export interface FakeSupabase {
  client: SupabaseClient<Database>;
  // Live tables: rows persist across runs that share this fake.
  readonly settings: AlertSettingsRow[];
  readonly notifications: AlertNotificationRow[];
  // Per-operation error injection; null means the operation succeeds.
  settingsError: PostgrestError | null;
  recentError: PostgrestError | null;
  insertError: PostgrestError | null;
}

export function createFakeSupabase(options: FakeSupabaseOptions): FakeSupabase {
  let nextId = 1;
  const notifications: AlertNotificationRow[] = (options.notifications ?? []).map((row) => ({
    ...row,
    id: row.id ?? nextId++,
    sent_at: row.sent_at ?? options.clock().toISOString(),
  }));
  nextId = Math.max(nextId, ...notifications.map((row) => row.id + 1));

  const state: Omit<FakeSupabase, "client"> = {
    settings: [...(options.settings ?? [])],
    notifications,
    settingsError: null,
    recentError: null,
    insertError: null,
  };

  const from = (table: string) => {
    if (table !== "alert_settings" && table !== "alert_notifications") {
      throw new Error(`Fake Supabase has no table "${table}"`);
    }
    const isSettings = table === "alert_settings";
    const rows = (): Row[] => (isSettings ? state.settings : state.notifications);
    return {
      select: (columns: string) =>
        new FakeSelect(
          rows,
          columns.split(",").map((column) => column.trim()),
          () => (isSettings ? state.settingsError : state.recentError),
        ),
      insert: (value: Tables["alert_notifications"]["Insert"]) => {
        if (isSettings) {
          throw new Error("Fake Supabase does not support inserts into alert_settings");
        }
        const error = state.insertError;
        if (error === null) {
          state.notifications.push({
            registration: null,
            ...value,
            id: nextId++,
            // The column default, now(), on the database clock.
            sent_at: value.sent_at ?? options.clock().toISOString(),
          });
        }
        return Promise.resolve({ data: null, error });
      },
    };
  };

  // The one cast: the fake covers only the query shapes the poller uses.
  const client = { from } as unknown as SupabaseClient<Database>;
  return Object.assign(state, { client });
}
