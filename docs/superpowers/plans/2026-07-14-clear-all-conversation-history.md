# 全量清理对话记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在对话历史扫帚菜单中安全地删除全部本地对话记录。

**Architecture:** 前端历史窗口复用现有 `chatClearBeforeEntries(timestamp)` 网关，以 `Number.MAX_SAFE_INTEGER` 选择全部记录。菜单项通过小型 UI 辅助函数生成，页面模块负责确认、调用网关、重载列表和发送 Tauri 事件。

**Tech Stack:** TypeScript、Vitest/JSDOM、Tauri 2。

## Global Constraints

- 不新增 Rust 命令、DTO 或聊天历史文件格式。
- 复用 `chatClearBeforeEntries(timestamp: number): Promise<ChatConversation[]>`。
- 保留一次不可恢复删除确认；取消操作不得调用网关。
- 继续使用现有 `chat://deleted`、`chat://history-changed` 事件协议。

---

### Task 1: 创建可测试的全量清理菜单项

**Files:**
- Modify: `src/history/history-ui.ts`
- Modify: `src/history/history-ui.test.ts`

**Interfaces:**
- Consumes: `onClear: () => void | Promise<void>`。
- Produces: `createClearAllHistoryItem(onClear): HTMLButtonElement`，文本为“清理全部对话记录”，类为 `fn-menu__item history-delete`。

- [ ] **Step 1: 写失败测试**

```ts
it("renders a destructive clear-all menu item", () => {
  const onClear = vi.fn();
  const item = createClearAllHistoryItem(onClear);

  expect(item.textContent).toBe("清理全部对话记录");
  expect(item.classList.contains("fn-menu__item")).toBe(true);
  expect(item.classList.contains("history-delete")).toBe(true);
  item.click();
  expect(onClear).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run src/history/history-ui.test.ts`

Expected: FAIL，提示 `createClearAllHistoryItem` 未导出。

- [ ] **Step 3: 写最小实现**

```ts
export function createClearAllHistoryItem(onClear: () => void | Promise<void>): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "fn-menu__item history-delete";
  item.textContent = "清理全部对话记录";
  item.addEventListener("click", () => { void onClear(); });
  return item;
}
```

- [ ] **Step 4: 确认测试通过**

Run: `npx vitest run src/history/history-ui.test.ts`

Expected: PASS。

### Task 2: 将全量清理接入历史窗口

**Files:**
- Modify: `src/history/main.ts`
- Test: `src/history/history-ui.test.ts`

**Interfaces:**
- Consumes: `createClearAllHistoryItem(onClear)` 与 `chatClearBeforeEntries(Number.MAX_SAFE_INTEGER)`。
- Produces: 扫帚菜单第三个危险项；确认后清空所有条目并刷新 UI。

- [ ] **Step 1: 写最小实现**

```ts
clearMenu.show([clearItem(7), clearItem(30), createClearAllHistoryItem(clearAll)]);

async function clearAll() {
  if (!await confirm("将删除所有对话。删除后无法恢复。", { title: "清理全部对话记录", kind: "warning" })) return;
  const removed = await chatClearBeforeEntries(Number.MAX_SAFE_INTEGER);
  if (removed.some((entry) => entry.id === activeConversationId)) {
    activeConversationId = null;
    void emit("chat://deleted", "");
  }
  await reload();
  void emit("chat://history-changed");
}
```

- [ ] **Step 2: 确认测试通过并验证应用**

Run: `npm test && npm run build`

Expected: 所有测试通过，TypeScript 与 Vite 构建成功。
