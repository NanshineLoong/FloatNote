import { describe, it, expect } from "vitest";
import { computeLayout, DEFAULT_PREFS, type LayoutPrefs } from "./layout";

// 这些用例固定 textPref=640 来演算几何（与产品默认 DEFAULT_PREFS.textPref 解耦，
// 后者可随手感调整而不影响算法断言）。
function prefs(over: Partial<LayoutPrefs> = {}): LayoutPrefs {
  return { ...DEFAULT_PREFS, textPref: 640, pad: 28, open: true, ...over };
}

// 演算参数：textPref=640, pad=28, assistPref=340, assistMin=280, gap=24
// 推导边界：Rpref=364, Rmin=304
//   symmetricMin = 640 + 2*364 = 1368
//   pressLeftMin = 640 + 364 + 28 = 1032
//   pressRightMin（=floatMin）= 640 + 304 + 28 = 972
//   textFitMin = 640 + 2*28 = 696
describe("computeLayout", () => {
  it("uses a compact 14px minimum text margin by default", () => {
    expect(DEFAULT_PREFS.pad).toBe(14);
    const l = computeLayout(380, { ...DEFAULT_PREFS, open: false });
    expect(l.textWidth).toBe(352);
    expect(l.leftMargin).toBe(14);
    expect(l.rightMargin).toBe(14);
  });

  describe("closed（助手关闭）", () => {
    it("宽窗：正文居中，无助手", () => {
      const l = computeLayout(1000, prefs({ open: false }));
      expect(l.mode).toBe("closed");
      expect(l.textWidth).toBe(640);
      expect(l.leftMargin).toBe(180);
      expect(l.rightMargin).toBe(180);
      expect(l.assistantWidth).toBe(0);
    });

    it("窄窗：正文收缩，边距落到 pad", () => {
      const l = computeLayout(400, prefs({ open: false }));
      expect(l.textWidth).toBe(344);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(28);
    });
  });

  describe("inline ① 对称（很宽）", () => {
    it("左右边距相等，助手满宽", () => {
      const l = computeLayout(1500, prefs());
      expect(l.mode).toBe("inline");
      expect(l.textWidth).toBe(640);
      expect(l.assistantWidth).toBe(340);
      expect(l.leftMargin).toBe(430);
      expect(l.rightMargin).toBe(430);
    });

    it("对称边界 symmetricMin=1368：左右边距=Rpref", () => {
      const l = computeLayout(1368, prefs());
      expect(l.leftMargin).toBe(364);
      expect(l.rightMargin).toBe(364);
      expect(l.assistantWidth).toBe(340);
    });
  });

  describe("inline ② 压左", () => {
    it("右边距固定 Rpref，左边距吃掉收缩，正文/助手不变", () => {
      const l = computeLayout(1200, prefs());
      expect(l.mode).toBe("inline");
      expect(l.textWidth).toBe(640);
      expect(l.assistantWidth).toBe(340);
      expect(l.rightMargin).toBe(364);
      expect(l.leftMargin).toBe(196);
    });

    it("压左边界 pressLeftMin=1032：左边距到 pad", () => {
      const l = computeLayout(1032, prefs());
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(364);
      expect(l.assistantWidth).toBe(340);
    });
  });

  describe("inline ③ 压右", () => {
    it("左边距固定 pad，右边距/助手一起收缩，正文不变", () => {
      const l = computeLayout(1000, prefs());
      expect(l.mode).toBe("inline");
      expect(l.textWidth).toBe(640);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(332);
      expect(l.assistantWidth).toBe(308);
    });

    it("压右边界 pressRightMin=972：助手到 assistMin，右边距=Rmin", () => {
      const l = computeLayout(972, prefs());
      expect(l.mode).toBe("inline");
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(304);
      expect(l.assistantWidth).toBe(280);
    });
  });

  describe("floating", () => {
    it("跨过 972 助手浮起：正文仍 640、靠左，右边距退为空白territory", () => {
      const l = computeLayout(971, prefs());
      expect(l.mode).toBe("floating");
      expect(l.textWidth).toBe(640);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(303);
      expect(l.assistantWidth).toBe(0);
    });

    it("继续变窄：右边距继续缩，正文恒 640 靠左", () => {
      const l = computeLayout(800, prefs());
      expect(l.mode).toBe("floating");
      expect(l.textWidth).toBe(640);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(132);
    });

    it("textFitMin=696：左右边距都到 pad，正文恰好 640", () => {
      const l = computeLayout(696, prefs());
      expect(l.textWidth).toBe(640);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(28);
    });

    it("更窄：正文被动收缩、居中（助手早已浮走）", () => {
      const l = computeLayout(400, prefs());
      expect(l.mode).toBe("floating");
      expect(l.textWidth).toBe(344);
      expect(l.leftMargin).toBe(28);
      expect(l.rightMargin).toBe(28);
    });

    it("默认窗宽 380：floating，正文铺满", () => {
      const l = computeLayout(380, prefs());
      expect(l.mode).toBe("floating");
      expect(l.textWidth).toBe(324);
      expect(l.leftMargin).toBe(28);
    });
  });

  describe("连续性（inline↔floating 交界零跳变）", () => {
    it("972(inline) 与 971(floating) 的正文几何近乎相等", () => {
      const inline = computeLayout(972, prefs());
      const floating = computeLayout(971, prefs());
      expect(inline.textWidth).toBe(floating.textWidth);
      expect(inline.leftMargin).toBe(floating.leftMargin);
      expect(Math.abs(inline.rightMargin - floating.rightMargin)).toBeLessThanOrEqual(1);
    });

    it("整条曲线上 leftMargin 单调不增（窗越宽，左边距不会更小）", () => {
      let prev = -Infinity;
      for (let w = 360; w <= 1600; w += 1) {
        const left = computeLayout(w, prefs()).leftMargin;
        expect(left).toBeGreaterThanOrEqual(prev - 0.001);
        prev = left;
      }
    });
  });

  // 小人横坐标：botW=46, botInset=30 → followX = width-76；stopX = leftMargin+640+24。
  describe("botX（小人横向：连续、跟随→停靠）", () => {
    it("窄窗：小人跟随窗口右缘（followX = width-76）", () => {
      expect(computeLayout(700, prefs()).botX).toBe(700 - 76);
    });

    it("≈768 起停在正文右侧 stopX=692，再宽也不右移（直到对称区）", () => {
      expect(computeLayout(768, prefs()).botX).toBe(692); // followX 恰好追上 stopX
      expect(computeLayout(900, prefs()).botX).toBe(692); // 仍 floating，小人已停
      expect(computeLayout(972, prefs()).botX).toBe(692); // 切 inline，小人不动
    });

    it("floating↔inline 交界（972/971）botX 零跳变", () => {
      const inline = computeLayout(972, prefs()).botX;
      const floating = computeLayout(971, prefs()).botX;
      expect(inline).toBe(floating);
    });

    it("对称区：小人黏在正文右侧（随正文居中右移）", () => {
      const l = computeLayout(1500, prefs());
      expect(l.botX).toBe(l.leftMargin + l.textWidth + 24);
    });

    it("整条曲线上 botX 连续（相邻 1px 宽度差 ≤ 1px，无瞬跳）", () => {
      let prev = computeLayout(360, prefs()).botX;
      for (let w = 361; w <= 1600; w += 1) {
        const x = computeLayout(w, prefs()).botX;
        expect(Math.abs(x - prev)).toBeLessThanOrEqual(1.001);
        prev = x;
      }
    });

    it("整条曲线上 botX 单调不减（窗越宽，小人不会左跳）", () => {
      let prev = -Infinity;
      for (let w = 360; w <= 1600; w += 1) {
        const x = computeLayout(w, prefs()).botX;
        expect(x).toBeGreaterThanOrEqual(prev - 0.001);
        prev = x;
      }
    });
  });
});
