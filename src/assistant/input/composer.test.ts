// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountComposer, type ComposerHandle } from "./composer";
import type { PromptPayload } from "./submit";
import { REF_OPEN } from "./model";

// jsdom 的 Range 尚未实现布局 rect；CM6 测试只需要一个空的稳定结果。
if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
}

interface Setup {
  handle: ComposerHandle;
  submitted: PromptPayload[];
  getEmptySends: () => number;
  editorHost: HTMLElement;
}

function makeComposer(opts: {
  files?: { name: string; kind: "inbox" | "tasks" | "piece" | "doc" }[];
  skills?: { name: string; description: string }[];
} = {}): Setup {
  const files = opts.files ?? [{ name: "piece.md", kind: "piece" as const }];
  const skills = opts.skills ?? [{ name: "summarize", description: "总结" }];
  const submitted: PromptPayload[] = [];
  let emptySends = 0;
  const wrapHost = document.createElement("div");
  wrapHost.className = "assistant-input-wrap";
  const editorHost = document.createElement("div");
  editorHost.className = "assistant-input-host";
  wrapHost.appendChild(editorHost);
  document.body.appendChild(wrapHost);
  const handle = mountComposer({
    editorHost,
    wrapHost,
    placeholder: "说点什么…",
    getScope: () => ({ scopeType: "project", scopePath: "p", scopeLabel: "p", cwd: "p" }),
    listFiles: async () => files,
    listSkills: async () => skills,
    onSubmit: (p) => submitted.push(p),
    onEmptySend: () => (emptySends += 1),
  });
  return { handle, submitted, getEmptySends: () => emptySends, editorHost };
}

describe("composer", () => {
  let handle: ComposerHandle;
  let submitted: PromptPayload[];
  let getEmptySends: () => number;

  beforeEach(() => {
    const r = makeComposer();
    handle = r.handle;
    submitted = r.submitted;
    getEmptySends = r.getEmptySends;
  });
  afterEach(() => {
    handle.destroy();
    document.body.replaceChildren();
  });

  it("@ 触发文件候选 popover", async () => {
    handle.insertText("你好 @pi");
    await vi.waitFor(() => expect(handle.isPopoverOpen()).toBe(true));
  });

  it("/ 触发 skill 候选 popover", async () => {
    handle.insertText("/sum");
    await vi.waitFor(() => expect(handle.isPopoverOpen()).toBe(true));
  });

  it("Enter 确认候选 → 插入 chip，不提交", async () => {
    handle.insertText("@pi");
    await vi.waitFor(() => expect(handle.isPopoverOpen()).toBe(true));
    handle.pressKey("Enter");
    expect(handle.isPopoverOpen()).toBe(false);
    expect(submitted.length).toBe(0);
    expect(handle.getDoc()).toContain(REF_OPEN);
  });

  it("无候选时 Enter 提交结构化 payload", () => {
    handle.insertText("你好");
    handle.pressKey("Enter");
    expect(submitted.length).toBe(1);
    expect(submitted[0].userText).toBe("你好");
    expect(submitted[0].references).toEqual([]);
  });

  it("Shift-Enter 插入换行而不提交", () => {
    handle.insertText("第一行");
    handle.pressKey("Enter", { shiftKey: true });

    expect(handle.getDoc()).toBe("第一行\n");
    expect(submitted).toEqual([]);
  });

  it("空输入 Enter → onEmptySend", () => {
    handle.focus();
    handle.pressKey("Enter");
    expect(getEmptySends()).toBe(1);
    expect(submitted.length).toBe(0);
  });

  it("IME 组合中 Enter 不提交，也不让默认键位改写文档", () => {
    handle.__setComposing(true);
    handle.insertText("正在组合");
    const before = handle.getDoc();

    handle.pressKey("Enter");

    expect(handle.getDoc()).toBe(before);
    expect(submitted.length).toBe(0);
    handle.__setComposing(false);
    handle.pressKey("Enter");
    expect(submitted).toEqual([{ userText: "正在组合", references: [] }]);
  });

  it("openSkillPicker 插入 / 并打开 skill 候选", async () => {
    handle.openSkillPicker();
    await vi.waitFor(() => expect(handle.isPopoverOpen()).toBe(true));
    handle.pressKey("Enter");
    expect(handle.getDoc()).toContain(REF_OPEN);
    expect(submitted.length).toBe(0);
  });

  it("expand/collapse large mode", () => {
    expect(handle.isLarge()).toBe(false);
    handle.expandLarge();
    expect(handle.isLarge()).toBe(true);
    handle.collapseLarge();
    expect(handle.isLarge()).toBe(false);
  });

  it("仅在常规输入区长到最大高度时允许放大", () => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 80 },
      scrollHeight: { configurable: true, value: 80 },
    });
    expect(handle.isHeightLimited()).toBe(false);

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 160 },
    });
    expect(handle.isHeightLimited()).toBe(true);
  });

  it("输入器盒模型达到最大高度时允许放大", () => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 118 },
    });

    expect(handle.isHeightLimited()).toBe(true);
  });

  it("Escape 关闭 popover 不影响已输入内容", async () => {
    handle.insertText("你好 @pi");
    await vi.waitFor(() => expect(handle.isPopoverOpen()).toBe(true));
    handle.pressKey("Escape");
    expect(handle.isPopoverOpen()).toBe(false);
    expect(handle.getDoc()).toBe("你好 @pi");
  });
});
