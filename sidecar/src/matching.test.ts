import { describe, it, expect } from "vitest";
import { replaceOnce } from "./matching.js";

describe("replaceOnce", () => {
  it("replaces a unique match", () => {
    const r = replaceOnce("a\nb\nc", "b", "B");
    expect(r).toEqual({ ok: true, newContent: "a\nB\nc" });
  });
  it("rejects zero matches", () => {
    expect(replaceOnce("a\nb", "z", "Z")).toEqual({ ok: false, error: expect.any(String) });
  });
  it("rejects multiple matches", () => {
    expect(replaceOnce("a a a", "a", "b")).toEqual({ ok: false, error: expect.any(String) });
  });
});
