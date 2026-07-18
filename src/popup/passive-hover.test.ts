import { describe, expect, it } from "vitest";
import { passiveHoverTargetAt, type PassiveHoverTarget } from "./passive-hover";

const targets: PassiveHoverTarget[] = [
  { id: "capture", disabled: false, rect: { left: 8, top: 6, right: 52, bottom: 34 } },
  { id: "translate", disabled: false, rect: { left: 56, top: 6, right: 108, bottom: 34 } },
  { id: "question", disabled: true, rect: { left: 112, top: 6, right: 164, bottom: 34 } },
];

describe("passive popup hover", () => {
  it("converts a global cursor position to the matching local action", () => {
    expect(passiveHoverTargetAt({ x: 262, y: 228 }, { x: 200, y: 200 }, targets)).toBe("translate");
  });

  it("clears the hover target outside the popup", () => {
    expect(passiveHoverTargetAt({ x: 190, y: 228 }, { x: 200, y: 200 }, targets)).toBeNull();
  });

  it("does not highlight disabled actions", () => {
    expect(passiveHoverTargetAt({ x: 320, y: 228 }, { x: 200, y: 200 }, targets)).toBeNull();
  });
});
