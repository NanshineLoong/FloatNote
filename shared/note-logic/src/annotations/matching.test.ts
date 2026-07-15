import { describe, expect, it } from "vitest";
import { findExactText } from "./matching";

describe("findExactText", () => {
  it("uses prefix and suffix to disambiguate repeated text", () => {
    expect(findExactText("alpha target one; beta target two", {
      exact: "target",
      prefix: "beta ",
      suffix: " two",
    })).toEqual({ ok: true, from: 23, to: 29 });
  });

  it("rejects ambiguous matches", () => {
    expect(findExactText("target and target", { exact: "target" })).toEqual({
      ok: false,
      error: "ambiguous",
    });
  });
});
