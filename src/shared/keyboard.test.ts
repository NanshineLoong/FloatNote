import { describe, expect, it } from "vitest";
import { isImeComposing } from "./keyboard";

describe("isImeComposing", () => {
  it("recognizes the standard composition flag", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 } as KeyboardEvent)).toBe(true);
  });

  it("recognizes WebKit's composition key code fallback", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
  });

  it("does not suppress a normal Enter key", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false);
  });
});
