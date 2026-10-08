import { describe, expect, it } from "vitest";
import { parsePauseForm } from "@/lib/alert-settings";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("parsePauseForm", () => {
  it('pauses on "true"', () => {
    expect(parsePauseForm(form({ paused: "true" }))).toEqual({ ok: true, paused: true });
  });

  it('resumes on "false"', () => {
    expect(parsePauseForm(form({ paused: "false" }))).toEqual({ ok: true, paused: false });
  });

  it("rejects a missing field", () => {
    expect(parsePauseForm(form({}))).toEqual({ ok: false, error: "Invalid pause request" });
  });

  it("rejects other values", () => {
    expect(parsePauseForm(form({ paused: "yes" }))).toEqual({ ok: false, error: "Invalid pause request" });
  });

  it("accepts only the exact lowercase values", () => {
    expect(parsePauseForm(form({ paused: "TRUE" }))).toEqual({ ok: false, error: "Invalid pause request" });
  });
});
