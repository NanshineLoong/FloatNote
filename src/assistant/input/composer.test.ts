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
  resolveSubmit: (accepted: boolean) => void;
}

function makeComposer(opts: {
  files?: { name: string; kind: "inbox" | "tasks" | "piece" | "doc" }[];
  skills?: { name: string; description: string }[];
  submitImmediately?: boolean;
} = {}): Setup {
  const files = opts.files ?? [{ name: "piece.md", kind: "piece" as const }];
  const skills = opts.skills ?? [{ name: "summarize", description: "总结" }];
  const submitted: PromptPayload[] = [];
  let emptySends = 0;
  let resolveSubmit = (_accepted: boolean) => {};
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
    onSubmit: (p) => {
      submitted.push(p);
      if (opts.submitImmediately !== false) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        resolveSubmit = resolve;
      });
    },
    onEmptySend: () => (emptySends += 1),
  });
  return {
    handle,
    submitted,
    getEmptySends: () => emptySends,
    editorHost,
    resolveSubmit: (accepted) => resolveSubmit(accepted),
  };
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

  it("无候选时 Enter 提交结构化 payload", async () => {
    handle.insertText("你好");
    handle.pressKey("Enter");
    expect(submitted.length).toBe(1);
    expect(submitted[0].userText).toBe("你好");
    expect(submitted[0].references).toEqual([]);
    await vi.waitFor(() => expect(handle.getDoc()).toBe(""));
  });

  it("聚焦纸张中 Enter 插入换行且不提交", () => {
    handle.insertText("第一行");
    handle.expandLarge();

    handle.pressKey("Enter");

    expect(handle.getDoc()).toBe("第一行\n");
    expect(submitted).toEqual([]);
    expect(handle.isLarge()).toBe(true);
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

  it("IME 组合中 Enter 不提交，也不让默认键位改写文档", async () => {
    handle.__setComposing(true);
    handle.insertText("正在组合");
    const before = handle.getDoc();

    handle.pressKey("Enter");

    expect(handle.getDoc()).toBe(before);
    expect(submitted.length).toBe(0);
    handle.__setComposing(false);
    handle.pressKey("Enter");
    expect(submitted).toEqual([{ userText: "正在组合", references: [] }]);
    await vi.waitFor(() => expect(handle.getDoc()).toBe(""));
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

  it("只把输入框主题类挂到 CodeMirror 根节点", () => {
    const editor = document.querySelector<HTMLElement>(".cm-editor")!;
    const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;

    expect(editor.classList.contains("fn-assistant-input")).toBe(true);
    expect(scroller.classList.contains("fn-assistant-input")).toBe(false);
  });

  it("CodeMirror 重写聚焦属性后仍保留输入框主题类", async () => {
    const editor = document.querySelector<HTMLElement>(".cm-editor")!;
    const content = document.querySelector<HTMLElement>(".cm-content")!;

    expect(editor.classList.contains("fn-assistant-input")).toBe(true);

    handle.focus();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(editor.classList.contains("cm-focused")).toBe(true);
    expect(editor.classList.contains("fn-assistant-input")).toBe(true);

    content.blur();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    handle.focus();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(editor.classList.contains("cm-focused")).toBe(true);
    expect(editor.classList.contains("fn-assistant-input")).toBe(true);
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

  it("成功提交后清空并收起聚焦纸张", async () => {
    const setup = makeComposer({ submitImmediately: false });
    setup.handle.insertText("保留到后端接受");
    setup.handle.expandLarge();

    setup.handle.submit();
    expect(setup.handle.getDoc()).toBe("保留到后端接受");
    expect(setup.handle.isLarge()).toBe(true);

    setup.resolveSubmit(true);
    await vi.waitFor(() => expect(setup.handle.getDoc()).toBe(""));
    expect(setup.handle.isLarge()).toBe(false);
    setup.handle.destroy();
  });

  it("失败提交保留文档并保持聚焦纸张打开", async () => {
    const setup = makeComposer({ submitImmediately: false });
    setup.handle.insertText("不要丢失");
    setup.handle.expandLarge();

    setup.handle.submit();
    setup.resolveSubmit(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(setup.handle.getDoc()).toBe("不要丢失");
    expect(setup.handle.isLarge()).toBe(true);
    setup.handle.destroy();
  });

  it("提交握手未完成时不会重复发送", () => {
    const setup = makeComposer({ submitImmediately: false });
    setup.handle.insertText("只发送一次");

    setup.handle.submit();
    setup.handle.submit();

    expect(setup.submitted).toHaveLength(1);
    setup.resolveSubmit(false);
    setup.handle.destroy();
  });

  it("旧提交成功不会清空等待期间继续编辑的新草稿", async () => {
    const setup = makeComposer({ submitImmediately: false });
    setup.handle.insertText("已提交");
    setup.handle.expandLarge();
    setup.handle.submit();
    setup.handle.insertText(" 后续草稿");

    setup.resolveSubmit(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(setup.handle.getDoc()).toBe("已提交 后续草稿");
    expect(setup.handle.isLarge()).toBe(true);
    setup.handle.destroy();
  });

  it("聚焦纸张中的空提交不收起也不打开历史入口", () => {
    handle.expandLarge();
    handle.submit();

    expect(handle.isLarge()).toBe(true);
    expect(getEmptySends()).toBe(0);
    expect(submitted).toEqual([]);
  });
});
