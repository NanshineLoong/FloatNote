import { describe, expect, it } from "vitest";
import { selectedText } from "./local-selection";

describe("local selection snapshot", () => {
  it("returns only a focused non-empty selection", () => {
    expect(selectedText("hello world", 0, 5, true)).toBe("hello");
    expect(selectedText("hello world", 3, 3, true)).toBeNull();
    expect(selectedText("hello world", 0, 5, false)).toBeNull();
    expect(selectedText("hello world", 0, 99, true)).toBeNull();
  });
});
