// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountInputOverlay } from "./overlay";

describe("input overlay", () => {
  let host: HTMLElement;
  let view: { requestMeasure: () => void; focus: () => void };
  let collapsed: boolean;
  let overlay: ReturnType<typeof mountInputOverlay>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    view = { requestMeasure: vi.fn(), focus: vi.fn() };
    collapsed = false;
    overlay = mountInputOverlay({
      host,
      getView: () => view,
      onCollapse: () => (collapsed = true),
    });
  });
  afterEach(() => {
    overlay.destroy();
    document.body.replaceChildren();
  });

  it("expand 加 .fn-input-large 类 + 遮罩可见", () => {
    overlay.expand();
    expect(host.classList.contains("fn-input-large")).toBe(true);
    const backdrop = document.querySelector(".fn-input-overlay-backdrop") as HTMLElement;
    expect(backdrop).toBeTruthy();
    expect(backdrop.hidden).toBe(false);
    expect(overlay.isLarge()).toBe(true);
  });

  it("collapse 去类 + 隐藏遮罩 + 触发 onCollapse", () => {
    overlay.expand();
    overlay.collapse();
    expect(host.classList.contains("fn-input-large")).toBe(false);
    expect((document.querySelector(".fn-input-overlay-backdrop") as HTMLElement).hidden).toBe(true);
    expect(collapsed).toBe(true);
    expect(overlay.isLarge()).toBe(false);
  });

  it("expand 后 requestAnimationFrame 触发 view.requestMeasure + focus", () => {
    overlay.expand();
    // rAF 在 jsdom 下不自动跑；手动 flush
    return new Promise((resolve) => requestAnimationFrame(() => resolve(null))).then(() => {
      expect(view.requestMeasure).toHaveBeenCalled();
      expect(view.focus).toHaveBeenCalled();
    });
  });

  it("点遮罩收回", () => {
    overlay.expand();
    const backdrop = document.querySelector(".fn-input-overlay-backdrop") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overlay.isLarge()).toBe(false);
    expect(collapsed).toBe(true);
  });

  it("toggle 在展开/收回间切换", () => {
    expect(overlay.isLarge()).toBe(false);
    overlay.toggle();
    expect(overlay.isLarge()).toBe(true);
    overlay.toggle();
    expect(overlay.isLarge()).toBe(false);
  });

  it("destroy 清类 + 移除遮罩", () => {
    overlay.expand();
    overlay.destroy();
    expect(host.classList.contains("fn-input-large")).toBe(false);
    expect(document.querySelector(".fn-input-overlay-backdrop")).toBeNull();
  });
});
