import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "@/lib/alert-settings";
import { GENERIC_ERROR_MESSAGE, messageForCode, telegramErrorCode } from "@/lib/form-errors";

describe("messageForCode", () => {
  it("returns null when there is no code", () => {
    expect(messageForCode(null)).toBeNull();
    expect(messageForCode("")).toBeNull();
  });

  it("maps a known code to its fixed message", () => {
    expect(messageForCode("radius_range")).toBe(VALIDATION_MESSAGES.radius_range);
    expect(messageForCode("settings_missing")).toBe("Your settings record is missing. Please contact support.");
  });

  it("shows the generic message for an unknown code", () => {
    expect(messageForCode("<script>evil</script>")).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageForCode("Your account is locked")).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("does not treat inherited object properties as codes", () => {
    expect(messageForCode("toString")).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageForCode("__proto__")).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("has a message for every validation code", () => {
    for (const [code, message] of Object.entries(VALIDATION_MESSAGES)) {
      expect(messageForCode(code)).toBe(message);
    }
  });
});

describe("telegramErrorCode", () => {
  it("recognises an unknown chat", () => {
    expect(telegramErrorCode("Bad Request: chat not found")).toBe("telegram_chat_not_found");
  });

  it("recognises a blocked bot", () => {
    expect(telegramErrorCode("Forbidden: bot was blocked by the user")).toBe("telegram_blocked");
  });

  it("falls back to a generic Telegram code", () => {
    expect(telegramErrorCode("No response within 10 s")).toBe("telegram_failed");
  });
});
