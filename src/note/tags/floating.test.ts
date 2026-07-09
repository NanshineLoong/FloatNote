// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { closeFloating, floatMenu, floatMenuAnchored } from "./floating.js";

function makeEl(w: number, h: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "switch-menu";
  el.style.position = "fixed";
  // jsdom 不布局，getBoundingClientRect 需 spy 成指定尺寸。
  el.getBoundingClientRect = () =>
    ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  return el;
}

const original = { iw: window.innerWidth, ih: window.innerHeight };

afterEach(() => {
  closeFloating();
  Object.defineProperty(window, "innerWidth", { value: original.iw, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: original.ih, writable: true, configurable: true });
});

describe("floatMenu clamp", () => {
  it("pulls a cursor menu back into the viewport when it would overflow right/bottom", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const el = makeEl(280, 280);
    floatMenu(el, 360, 480); // 光标在右下角
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    expect(left + 280).toBeLessThanOrEqual(380);
    expect(top + 280).toBeLessThanOrEqual(520);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});

describe("floatMenuAnchored", () => {
  it("collapsed bot (bottom-right): up-left places menu to the upper-left of the anchor and in-viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const el = makeEl(240, 180);
    // 小人贴窗口右下角：left 320..366, top 460..506
    const anchor: DOMRect = {
      width: 46, height: 46, left: 320, top: 460, right: 366, bottom: 506, x: 320, y: 460, toJSON: () => {},
    } as DOMRect;
    floatMenuAnchored(el, anchor, "up-left");
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    // 菜单底边应在 anchor 顶边上方（开在上方）
    expect(top + 180).toBeLessThanOrEqual(anchor.top);
    // 整体落在视口内
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + 240).toBeLessThanOrEqual(380);
    expect(top + 180).toBeLessThanOrEqual(520);
  });

  it("expanded bot: up-right places menu to the upper-right of the anchor", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const el = makeEl(240, 180);
    // 展开态 bot 偏左：left 40..86, top 460..506
    const anchor: DOMRect = {
      width: 46, height: 46, left: 40, top: 460, right: 86, bottom: 506, x: 40, y: 460, toJSON: () => {},
    } as DOMRect;
    floatMenuAnchored(el, anchor, "up-right");
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    // 菜单左边应在 anchor 右边右侧（向右展开）
    expect(left).toBeGreaterThanOrEqual(anchor.right);
    expect(top + 180).toBeLessThanOrEqual(anchor.top);
  });

  it("flips below the anchor when there is no room above", () => {
    Object.defineProperty(window, "innerWidth", { value: 1000, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    const el = makeEl(240, 180);
    // anchor 几乎贴顶：上方放不下
    const anchor: DOMRect = {
      width: 46, height: 46, left: 40, top: 10, right: 86, bottom: 56, x: 40, y: 10, toJSON: () => {},
    } as DOMRect;
    floatMenuAnchored(el, anchor, "up-right");
    const top = parseFloat(el.style.top);
    // 翻到下方：菜单顶边在 anchor 底边之下
    expect(top).toBeGreaterThanOrEqual(anchor.bottom);
  });
});
