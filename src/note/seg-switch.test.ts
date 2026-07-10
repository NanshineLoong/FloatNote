import { describe, it, expect } from "vitest";
import { viewToIdx, maxReachableIdx, type Reach } from "./seg-switch";

const FULL: Reach = "full";
const NARROW: Reach = "narrow";

describe("viewToIdx", () => {
  it("maps the three segments in order 采集 → 写作 → 双栏", () => {
    expect(viewToIdx("inbox")).toBe(0);
    expect(viewToIdx("piece")).toBe(1);
    expect(viewToIdx("split")).toBe(2);
  });
});

describe("maxReachableIdx", () => {
  it("allows 双栏 only when the window is wide enough", () => {
    expect(maxReachableIdx(FULL)).toBe(2);
    // 窄窗下双栏不可达：方向键与点击都到不了 split，
    // 由此保证窄窗下 onSelectView("split") 永不被调用。
    expect(maxReachableIdx(NARROW)).toBe(1);
  });
});
