# AI 输入框聚焦样式修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证 CodeMirror 助手输入器在首次聚焦、失焦、再次聚焦以及聚焦纸张切换后始终保留稳定的输入框根 class 与对应边框样式。

**Architecture:** 把 `fn-assistant-input` 从 CodeMirror 创建后的命令式 DOM 修改，迁移为 `EditorView.editorAttributes` 状态扩展。CodeMirror 每次重算根属性时会合并该 class，因此焦点状态更新不会再删除组件样式契约。

**Tech Stack:** TypeScript、CodeMirror 6、Vitest/JSDOM。

## Global Constraints

- 不使用 MutationObserver、定时器补 class、`!important` 或提高 CSS 权重掩盖问题。
- 不改变紧凑输入、聚焦纸张、引用 chip、提交和 IME 语义。
- 不重建 `EditorView`，不新增依赖。
- 保留用户工作区中现有的未提交修改。

---

### Task 1: 用聚焦生命周期回归测试复现 class 丢失

**Files:**
- Modify: `src/assistant/input/composer.test.ts`

**Interfaces:**
- Consumes: `ComposerHandle.focus()` 与真实 CodeMirror 根节点。
- Produces: 一个验证挂载、首次聚焦、失焦、再次聚焦后 class 均存在的回归测试。

- [x] **Step 1: 写失败测试**

```ts
it("keeps the input theme class when CodeMirror rewrites focus attributes", () => {
  const editor = document.querySelector<HTMLElement>(".cm-editor")!;
  const content = document.querySelector<HTMLElement>(".cm-content")!;

  expect(editor.classList.contains("fn-assistant-input")).toBe(true);
  handle.focus();
  expect(editor.classList.contains("cm-focused")).toBe(true);
  expect(editor.classList.contains("fn-assistant-input")).toBe(true);
  content.blur();
  handle.focus();
  expect(editor.classList.contains("fn-assistant-input")).toBe(true);
});
```

- [x] **Step 2: 确认测试因真实缺陷失败**

Run: `npx vitest run src/assistant/input/composer.test.ts`

Expected: FAIL，首次 `handle.focus()` 后 `fn-assistant-input` 不存在。

### Task 2: 通过 CodeMirror 属性 facet 持久注入 class

**Files:**
- Modify: `src/assistant/input/composer.ts`
- Test: `src/assistant/input/composer.test.ts`

**Interfaces:**
- Consumes: `EditorView.editorAttributes.of({ class: INPUT_CLASS })`。
- Produces: CodeMirror 管理的稳定根 class；不再调用 `view.dom.classList.add(INPUT_CLASS)`。

- [x] **Step 1: 写最小实现**

```ts
extensions: [
  history(),
  EditorView.editorAttributes.of({ class: INPUT_CLASS }),
  EditorView.lineWrapping,
  drawSelection(),
  placeholder(opts.placeholder),
  refExtension(),
]
```

其余键盘、DOM 事件和 update listener 扩展保持原顺序不变。

并删除：

```ts
view.dom.classList.add(INPUT_CLASS);
```

- [x] **Step 2: 确认聚焦回归测试通过**

Run: `npx vitest run src/assistant/input/composer.test.ts`

Expected: PASS。

- [x] **Step 3: 验证相关 CSS 和聚焦纸张测试**

Run: `npx vitest run src/assistant/input/overlay.test.ts src/assistant/focused-paper-css.test.ts src/note/split-css.test.ts`

Expected: PASS。

- [x] **Step 4: 验证完整前端测试与构建**

Run: `npm run test:frontend && npm run build:frontend`

Expected: 所有前端测试通过，TypeScript 与 Vite 构建成功。
