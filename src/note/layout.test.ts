import { describe, it, expect } from "vitest";
import { computeLayout, DEFAULT_PREFS, type LayoutPrefs } from "./layout";

function prefs(over: Partial<LayoutPrefs> = {}): LayoutPrefs {
  return { ...DEFAULT_PREFS, open: true, sticky: "embedded", ...over };
}

// 边界（默认值下）：wideMin=1032, overlapMin=972, symmetricMin=1368
describe("computeLayout", () => {
  it("closed: centers text, no assistant", () => {
    const l = computeLayout(1000, prefs({ open: false }));
    expect(l.placement).toBe("hidden");
    expect(l.zone).toBe("closed");
    expect(l.textWidth).toBe(640);
    expect(l.leftMargin).toBe(180);
    expect(l.rightMargin).toBe(180);
    expect(l.assistantWidth).toBe(0);
  });

  it("closed + narrow window: text shrinks, margins hit pad", () => {
    const l = computeLayout(400, prefs({ open: false }));
    expect(l.textWidth).toBe(344);
    expect(l.leftMargin).toBe(28);
  });

  it("very wide: embedded with equal left/right margins", () => {
    const l = computeLayout(1500, prefs());
    expect(l.placement).toBe("embedded");
    expect(l.zone).toBe("wide");
    expect(l.textWidth).toBe(640);
    expect(l.assistantWidth).toBe(340);
    expect(l.leftMargin).toBe(l.rightMargin);
    expect(l.leftMargin).toBe(430);
    expect(l.canToggle).toBe(false);
  });

  it("wide shrinking: left margin shrinks first, right region fixed", () => {
    const l = computeLayout(1200, prefs());
    expect(l.zone).toBe("wide");
    expect(l.placement).toBe("embedded");
    expect(l.textWidth).toBe(640);
    expect(l.assistantWidth).toBe(340);
    expect(l.rightMargin).toBe(364);
    expect(l.leftMargin).toBe(196);
  });

  it("wide boundary: left margin reaches pad at wideMin", () => {
    const l = computeLayout(1032, prefs());
    expect(l.zone).toBe("wide");
    expect(l.leftMargin).toBe(28);
    expect(l.assistantWidth).toBe(340);
  });

  it("overlap + sticky embedded: assistant squeezes, left at pad, can toggle", () => {
    const l = computeLayout(1000, prefs({ sticky: "embedded" }));
    expect(l.zone).toBe("overlap");
    expect(l.placement).toBe("embedded");
    expect(l.assistantWidth).toBe(308);
    expect(l.rightMargin).toBe(332);
    expect(l.leftMargin).toBe(28);
    expect(l.canToggle).toBe(true);
  });

  it("overlap + sticky detached: assistant pops out, text recenters", () => {
    const l = computeLayout(1000, prefs({ sticky: "detached" }));
    expect(l.zone).toBe("overlap");
    expect(l.placement).toBe("detached");
    expect(l.assistantWidth).toBe(0);
    expect(l.textWidth).toBe(640);
    expect(l.leftMargin).toBe(180);
    expect(l.canToggle).toBe(true);
  });

  it("narrow: forced detached regardless of sticky", () => {
    const embed = computeLayout(900, prefs({ sticky: "embedded" }));
    const det = computeLayout(900, prefs({ sticky: "detached" }));
    expect(embed.placement).toBe("detached");
    expect(det.placement).toBe("detached");
    expect(embed.zone).toBe("narrow");
    expect(embed.canToggle).toBe(false);
    expect(embed.textWidth).toBe(640);
    expect(embed.leftMargin).toBe(130);
  });

  it("very narrow: text shrinks toward window minimum", () => {
    expect(computeLayout(600, prefs()).textWidth).toBe(544);
    expect(computeLayout(360, prefs()).textWidth).toBe(304);
    expect(computeLayout(360, prefs()).leftMargin).toBe(28);
  });
});
