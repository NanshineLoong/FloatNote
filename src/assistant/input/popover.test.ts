// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { refExtension } from "./cm-extension";
import { RefPopover } from "./popover";
import { filterItems, type Candidate } from "./filter";
import type { Ref } from "./model";

const FILE: Ref = { kind: "file", id: "p/piece.md", display: "piece.md", meta: { noteKind: "piece" } };
const FILE2: Ref = { kind: "file", id: "p/piece-2.md", display: "piece-2.md", meta: { noteKind: "piece" } };

function makeView(): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({ doc: "你好", extensions: [refExtension()] }),
    parent: host,
  });
}

function candidate(ref: Ref, description?: string): Candidate {
  return { ref, description };
}

describe("RefPopover", () => {
  let view: EditorView;
  let popover: RefPopover;
  let selected: { ref: Ref; trigger: { from: number; to: number } } | null;
  let closed: boolean;

  beforeEach(() => {
    view = makeView();
    selected = null;
    closed = false;
    popover = new RefPopover({
      editorView: () => view,
      onSelect: (ref, trigger) => (selected = { ref, trigger }),
      onClose: () => (closed = true),
    });
  });
  afterEach(() => {
    popover.destroy();
    view.destroy();
    document.body.replaceChildren();
  });

  it("show 后打开并渲染候选项", () => {
    popover.show(filterItems([candidate(FILE), candidate(FILE2)], ""), { from: 3, to: 3 });
    expect(popover.isOpen()).toBe(true);
    const items = popover["el"].querySelectorAll(".fn-ref-popover-item");
    expect(items.length).toBe(2);
  });

  it("move 循环切换 active", () => {
    popover.show(filterItems([candidate(FILE), candidate(FILE2)], ""), { from: 3, to: 3 });
    expect(popover["el"].querySelector(".fn-ref-popover-item.active")?.getAttribute("data-index")).toBe("0");
    popover.move(1);
    expect(popover["el"].querySelector(".fn-ref-popover-item.active")?.getAttribute("data-index")).toBe("1");
    popover.move(1); // 循环回 0
    expect(popover["el"].querySelector(".fn-ref-popover-item.active")?.getAttribute("data-index")).toBe("0");
    popover.move(-1); // 回到末项
    expect(popover["el"].querySelector(".fn-ref-popover-item.active")?.getAttribute("data-index")).toBe("1");
  });

  it("confirm 触发 onSelect 并关闭", () => {
    popover.show(filterItems([candidate(FILE), candidate(FILE2)], ""), { from: 3, to: 6 });
    const ref = popover.confirm();
    expect(ref).toEqual(FILE);
    expect(selected).toEqual({ ref: FILE, trigger: { from: 3, to: 6 } });
    expect(popover.isOpen()).toBe(false);
    expect(closed).toBe(true);
  });

  it("空候选项显示无匹配", () => {
    popover.show([], { from: 3, to: 3 });
    expect(popover["el"].querySelector(".fn-ref-popover-empty")).toBeTruthy();
    expect(popover.confirm()).toBeNull();
  });

  it("鼠标 hover 同步 active", () => {
    popover.show(filterItems([candidate(FILE), candidate(FILE2)], ""), { from: 3, to: 3 });
    const second = popover["el"].querySelector('[data-index="1"]')!;
    second.dispatchEvent(new Event("mousemove", { bubbles: true }));
    expect(popover["el"].querySelector(".fn-ref-popover-item.active")?.getAttribute("data-index")).toBe("1");
  });

  it("外部 mousedown 关闭", () => {
    popover.show(filterItems([candidate(FILE)], ""), { from: 3, to: 3 });
    expect(popover.isOpen()).toBe(true);
    document.body.dispatchEvent(new PointerEvent("mousedown", { bubbles: true }));
    expect(popover.isOpen()).toBe(false);
    expect(closed).toBe(true);
  });

  it("popover 内部 mousedown 不关闭", () => {
    popover.show(filterItems([candidate(FILE)], ""), { from: 3, to: 3 });
    const item = popover["el"].querySelector(".fn-ref-popover-item")!;
    item.dispatchEvent(new PointerEvent("mousedown", { bubbles: true }));
    expect(popover.isOpen()).toBe(true);
  });
});
