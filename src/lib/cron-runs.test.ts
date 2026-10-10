import { describe, expect, it } from "vitest";
import { describeRunOutcome, MAX_RUN_ERROR_CHARS, type RunOutcome } from "@/lib/cron-runs";

describe("describeRunOutcome", () => {
  it.each<[string, RunOutcome, { status: "ok" | "error"; error: string | null }]>([
    ["no errors", { errors: [] }, { status: "ok", error: null }],
    ["one error", { errors: ["user 1: timeout"] }, { status: "error", error: "user 1: timeout" }],
    [
      "two errors",
      { errors: ["user 1: timeout", "user 2: 500"] },
      { status: "error", error: "user 1: timeout; user 2: 500" },
    ],
    ["a thrown Error", { thrown: new Error("boom") }, { status: "error", error: "boom" }],
    ["a thrown string", { thrown: "x" }, { status: "error", error: "x" }],
  ])("maps %s", (_label, outcome, expected) => {
    expect(describeRunOutcome(outcome)).toEqual(expected);
  });

  it("cuts a long joined error text to exactly 500 characters", () => {
    // Two 299-character errors joined with "; " give 600 characters.
    const first = "a".repeat(299);
    const second = "b".repeat(299);
    const result = describeRunOutcome({ errors: [first, second] });
    expect(MAX_RUN_ERROR_CHARS).toBe(500);
    expect(result.status).toBe("error");
    expect(result.error).toHaveLength(500);
    expect(result.error).toBe(`${first}; ${"b".repeat(199)}`);
  });

  it("cuts a long thrown message to exactly 500 characters", () => {
    const result = describeRunOutcome({ thrown: new Error("c".repeat(600)) });
    expect(result).toEqual({ status: "error", error: "c".repeat(500) });
  });
});
