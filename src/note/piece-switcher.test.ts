import { describe, expect, it } from "vitest";
import { outlineToggleState } from "./piece-switcher";

describe("outlineToggleState", () => {
  it("uses text-align-left icon and unpressed when outline is off", () => {
    expect(outlineToggleState(false)).toEqual({
      icon: "ph-text-align-left",
      pressed: false,
    });
  });

  it("uses list-tree icon and pressed when outline is on", () => {
    expect(outlineToggleState(true)).toEqual({
      icon: "ph-list-tree",
      pressed: true,
    });
  });
});
