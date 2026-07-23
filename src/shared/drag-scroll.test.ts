// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dragScroll, dragScrollSpeed, findScrollParent } from "./drag-scroll";

// jsdom 的 Range 没有布局测量：CM 内建 mousedown 选区（posAtCoords → scanText）会调
// getClientRects。补一个覆盖整行的假矩形，让原生选区逻辑能算出确定位置、不抛异常。
if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    value: () => [{ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }],
    configurable: true,
  });
}

/** jsdom 不布局：手动 mock 元素的滚动尺寸。 */
function mockSize(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

function mockRect(el: HTMLElement, rect: { top: number; bottom: number; left: number; right: number }) {
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** 手动驱动的 rAF：schedule 只收集回调，runFrame 才执行一帧。 */
function manualFrames() {
  let pending: FrameRequestCallback | null = null;
  return {
    schedule: (cb: FrameRequestCallback) => {
      pending = cb;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
    runFrame() {
      const cb = pending;
      pending = null;
      cb?.(0);
    },
    hasPending: () => pending !== null,
  };
}

interface Fixture {
  scroller: HTMLElement;
  view: EditorView;
  frames: ReturnType<typeof manualFrames>;
}

/** scroller(overflow:auto, 1000/200) > host > EditorView，rect 固定为 200px 高。 */
function fixture(): Fixture {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  mockSize(scroller, 1000, 200);
  mockRect(scroller, { top: 0, bottom: 200, left: 0, right: 300 });
  const host = document.createElement("div");
  scroller.appendChild(host);
  document.body.appendChild(scroller);

  const frames = manualFrames();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"),
      extensions: [dragScroll(frames)],
    }),
  });
  return { scroller, view, frames };
}

function mousedown(view: EditorView, init: MouseEventInit = {}) {
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1, clientX: 100, clientY: 100, ...init }),
  );
}

function mousemove(clientY: number, init: MouseEventInit = {}) {
  document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 100, clientY, ...init }));
}

function mouseup() {
  document.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("dragScrollSpeed", () => {
  it("触发带内（overshoot ≤ 0）恒为基础速度", () => {
    expect(dragScrollSpeed(-5)).toBe(6);
    expect(dragScrollSpeed(0)).toBe(6);
  });

  it("越界越远越快，并封顶", () => {
    expect(dragScrollSpeed(16)).toBe(14);
    expect(dragScrollSpeed(100)).toBe(28);
  });
});

describe("findScrollParent", () => {
  it("跳过 overflow:visible 的祖先，找到真正可滚的元素", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    mockSize(scroller, 1000, 200);
    const mid = document.createElement("div"); // 默认 overflow:visible
    const editor = document.createElement("div");
    scroller.appendChild(mid);
    mid.appendChild(editor);
    document.body.appendChild(scroller);

    expect(findScrollParent(editor)).toBe(scroller);
  });

  it("overflow:auto 但内容不溢出时不算可滚", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    mockSize(outer, 200, 200);
    const editor = document.createElement("div");
    outer.appendChild(editor);
    document.body.appendChild(outer);

    expect(findScrollParent(editor)).toBeNull();
  });
});

describe("dragScroll 拖动滚动", () => {
  it("指针进入底部触发带后按帧滚动，回安全区停止", () => {
    const { scroller, view, frames } = fixture();
    try {
      // 冻结 CM 原生 MouseSelection 的 50ms setInterval，只验证本扩展的帧滚动。
      vi.useFakeTimers();
      mousedown(view);
      mousemove(195); // 底部带内（200-32=168 < 195 < 200）→ 基础速度 6
      expect(frames.hasPending()).toBe(true);

      frames.runFrame();
      expect(scroller.scrollTop).toBe(6);
      frames.runFrame();
      expect(scroller.scrollTop).toBe(12);

      mousemove(220); // 越界 20px → 6 + 0.5*20 = 16
      frames.runFrame();
      expect(scroller.scrollTop).toBe(28);

      mousemove(100); // 回安全区 → 停止
      expect(frames.hasPending()).toBe(false);
      frames.runFrame();
      expect(scroller.scrollTop).toBe(28);
    } finally {
      view.destroy();
    }
  });

  it("指针越过顶部向上滚", () => {
    const { scroller, view, frames } = fixture();
    try {
      vi.useFakeTimers();
      scroller.scrollTop = 50;
      mousedown(view);
      mousemove(-10); // 越界 10px → -(6 + 0.5*10) = -11
      frames.runFrame();
      expect(scroller.scrollTop).toBe(39);
    } finally {
      view.destroy();
    }
  });

  it("mouseup 后清理监听，不再滚动", () => {
    const { scroller, view, frames } = fixture();
    try {
      vi.useFakeTimers();
      mousedown(view);
      mousemove(195);
      frames.runFrame();
      expect(scroller.scrollTop).toBe(6);

      mouseup();
      expect(frames.hasPending()).toBe(false);
      mousemove(195);
      frames.runFrame();
      expect(scroller.scrollTop).toBe(6);
    } finally {
      view.destroy();
    }
  });

  it("双击拖动不接管（词粒度选区留给 CM 原生）", () => {
    const { scroller, view, frames } = fixture();
    try {
      vi.useFakeTimers();
      mousedown(view, { detail: 2 });
      mousemove(195);
      expect(frames.hasPending()).toBe(false);
      expect(scroller.scrollTop).toBe(0);
    } finally {
      view.destroy();
    }
  });
});
