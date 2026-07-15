// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createMenu } from "./menu";

/** createMenu 内部用 el.getBoundingClientRect() 读菜单尺寸来 clamp，jsdom 不布局故 spy。 */
function spySize(handle: ReturnType<typeof createMenu>, w: number, h: number): void {
  handle.el.getBoundingClientRect = () =>
    ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
}

const original = { iw: window.innerWidth, ih: window.innerHeight };
const handles: Array<ReturnType<typeof createMenu>> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const h of handles) h.destroy();
  handles.length = 0;
  Object.defineProperty(window, "innerWidth", { value: original.iw, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: original.ih, writable: true, configurable: true });
});

describe("createMenu showAt clamp", () => {
  it("pulls a cursor menu back into the viewport when it would overflow right/bottom", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const handle = createMenu();
    handles.push(handle);
    spySize(handle, 280, 280);
    handle.showAt(360, 480, document.createElement("div")); // 光标在右下角
    const left = parseFloat(handle.el.style.left);
    const top = parseFloat(handle.el.style.top);
    expect(left + 280).toBeLessThanOrEqual(380);
    expect(top + 280).toBeLessThanOrEqual(520);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});

describe("createMenu outside-close lifecycle", () => {
  it("lets a second anchor click close the menu", () => {
    vi.useFakeTimers();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const handle = createMenu({ anchor });
    handles.push(handle);
    anchor.addEventListener("click", () => {
      if (handle.isOpen()) handle.hide();
      else handle.show(document.createElement("button"));
    });
    handle.show(document.createElement("button"));
    vi.runAllTimers();

    anchor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    anchor.click();

    expect(handle.isOpen()).toBe(false);
    anchor.remove();
  });

  it("stays armed after a submenu click and closes on the next outside click", () => {
    vi.useFakeTimers();
    const handle = createMenu();
    handles.push(handle);
    const trigger = document.createElement("button");
    const submenuItem = document.createElement("button");
    document.body.appendChild(trigger);
    handle.show(document.createElement("button"));
    handle.openSubmenu(trigger, [submenuItem]);
    vi.runAllTimers();

    submenuItem.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(handle.isOpen()).toBe(true);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(handle.isOpen()).toBe(false);
    trigger.remove();
  });
});

describe("createMenu anchored placement", () => {
  it("collapsed bot (bottom-right): up-left places menu to the upper-left of the anchor and in-viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const handle = createMenu({
      anchor: { width: 46, height: 46, left: 320, top: 460, right: 366, bottom: 506, x: 320, y: 460, toJSON: () => {} } as DOMRect,
      placement: "up-left",
    });
    handles.push(handle);
    spySize(handle, 240, 180);
    handle.show(document.createElement("div"));
    const left = parseFloat(handle.el.style.left);
    const top = parseFloat(handle.el.style.top);
    expect(top + 180).toBeLessThanOrEqual(460); // 菜单底边在 anchor 顶边上方
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + 240).toBeLessThanOrEqual(380);
    expect(top + 180).toBeLessThanOrEqual(520);
  });

  it("expanded bot: up-right places menu to the upper-right of the anchor", () => {
    Object.defineProperty(window, "innerWidth", { value: 380, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 520, writable: true, configurable: true });
    const handle = createMenu({
      anchor: { width: 46, height: 46, left: 40, top: 460, right: 86, bottom: 506, x: 40, y: 460, toJSON: () => {} } as DOMRect,
      placement: "up-right",
    });
    handles.push(handle);
    spySize(handle, 240, 180);
    handle.show(document.createElement("div"));
    const left = parseFloat(handle.el.style.left);
    const top = parseFloat(handle.el.style.top);
    expect(left).toBeGreaterThanOrEqual(86); // 菜单左边在 anchor 右边右侧
    expect(top + 180).toBeLessThanOrEqual(460);
  });

  it("flips below the anchor when there is no room above", () => {
    Object.defineProperty(window, "innerWidth", { value: 1000, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    const handle = createMenu({
      anchor: { width: 46, height: 46, left: 40, top: 10, right: 86, bottom: 56, x: 40, y: 10, toJSON: () => {} } as DOMRect,
      placement: "up-right",
    });
    handles.push(handle);
    spySize(handle, 240, 180);
    handle.show(document.createElement("div"));
    const top = parseFloat(handle.el.style.top);
    expect(top).toBeGreaterThanOrEqual(56); // 翻到下方：菜单顶边在 anchor 底边之下
  });

  it("down-right places the menu below the anchor with right edges aligned", () => {
    Object.defineProperty(window, "innerWidth", { value: 1000, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    // 版本入口贴窗口右上角：left 940..980, top 40..80
    const handle = createMenu({
      anchor: { width: 40, height: 40, left: 940, top: 40, right: 980, bottom: 80, x: 940, y: 40, toJSON: () => {} } as DOMRect,
      placement: "down-right",
    });
    handles.push(handle);
    spySize(handle, 200, 150);
    handle.show(document.createElement("div"));
    const left = parseFloat(handle.el.style.left);
    const top = parseFloat(handle.el.style.top);
    expect(top).toBeGreaterThanOrEqual(80); // 下方
    expect(left + 200).toBeLessThanOrEqual(980 + 1); // 右边对齐 anchor 右边（不溢出右侧）
  });
});
