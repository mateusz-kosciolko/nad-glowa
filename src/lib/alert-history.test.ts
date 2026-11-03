import { describe, expect, it } from "vitest";
import { canDeleteAlert, deletableAt, formatAlertTime, parseAlertIdForm } from "@/lib/alert-history";
import { DEDUP_WINDOW_MS } from "@/lib/alerts";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("parseAlertIdForm", () => {
  it("accepts a positive integer", () => {
    expect(parseAlertIdForm(form({ id: "42" }))).toEqual({ ok: true, id: 42 });
  });

  it.each(["", "0", "-1", "1.5", "1e3", "abc", " 7", "007", "9007199254740992"])("rejects %j", (id) => {
    expect(parseAlertIdForm(form({ id }))).toEqual({ ok: false, code: "alert_id_invalid" });
  });

  it("rejects a missing field", () => {
    expect(parseAlertIdForm(form({}))).toEqual({ ok: false, code: "alert_id_invalid" });
  });
});

describe("canDeleteAlert", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const sentAgo = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("keeps an entry still inside the dedup window", () => {
    expect(canDeleteAlert(sentAgo(DEDUP_WINDOW_MS - 1000), now)).toBe(false);
  });

  // The same boundary as isRecentlyAlerted: an entry exactly one window old no longer blocks a new alert.
  it("allows an entry exactly one window old", () => {
    expect(canDeleteAlert(sentAgo(DEDUP_WINDOW_MS), now)).toBe(true);
  });

  it("allows an older entry", () => {
    expect(canDeleteAlert(sentAgo(DEDUP_WINDOW_MS * 5), now)).toBe(true);
  });
});

describe("deletableAt", () => {
  it("is one dedup window after sending", () => {
    expect(deletableAt("2026-11-03T12:00:00Z").toISOString()).toBe("2026-11-03T13:00:00.000Z");
  });
});

describe("formatAlertTime", () => {
  it("shows Warsaw time, also across a day boundary", () => {
    expect(formatAlertTime("2026-11-03T23:30:00Z")).toBe("04 Nov 2026, 00:30");
  });
});
