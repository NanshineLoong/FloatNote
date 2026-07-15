import { describe, expect, it } from "vitest";
import { shouldSendPopupQuestion } from "./keyboard";

function keydown(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  } as KeyboardEvent;
}

describe("popup question keyboard handling", () => {
  it("sends on a plain Enter", () => {
    expect(shouldSendPopupQuestion(keydown())).toBe(true);
  });

  it("does not send on Shift+Enter", () => {
    expect(shouldSendPopupQuestion(keydown({ shiftKey: true }))).toBe(false);
  });

  it("does not send while an IME composition is active", () => {
    expect(shouldSendPopupQuestion(keydown({ isComposing: true }))).toBe(false);
    expect(shouldSendPopupQuestion(keydown({ keyCode: 229 }))).toBe(false);
  });
});
