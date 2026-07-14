# Assistant Message Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a live assistant response stoppable, give completed AI text a copy-only action, and provide retry plus inline edit-and-resend on user messages.

**Architecture:** Keep persisted conversation data and the Tauri sidecar protocol unchanged. Extend the pure chat reducer with a targeted user-message replacement event, keep transient inline-editor state in the message DOM renderer, and make `assistant.ts` the sole owner of retry/edit-send request dispatch and composer primary-action state.

**Tech Stack:** TypeScript, Vitest, jsdom, DOM custom events, existing Tauri `agent_cancel` and `agent_send` adapters, Phosphor icons, CSS custom properties.

## Global Constraints

- Do not change the Tauri command contracts or persisted chat-history format.
- Preserve user-message references when retrying or editing a message.
- Do not use the global CodeMirror composer as an inline editor; it must retain its own draft.
- While any assistant message streams, the composer primary action is `停止生成` and user retry/edit actions are disabled.
- AI text blocks get copy only after completion; they never get retry.
- Keep macOS and Windows behavior platform-neutral; all work is DOM/TypeScript/CSS.

---

## File structure

- `src/assistant/render/state.ts` owns the immutable `user_edit` event used to replace one existing user message by its stable id.
- `src/assistant/render.test.ts` tests the reducer event without DOM dependencies.
- `src/assistant/render/view.ts` renders assistant copy-only actions and user retry/edit controls, including the temporary inline textarea UI and its custom events.
- `src/assistant/blocks.ts` reconciles a changed user message by replacing its message node while retaining stable nodes for all other messages.
- `src/assistant/blocks.test.ts` verifies action visibility, inline-edit events, and cancellation of temporary DOM state.
- `src/assistant/assistant.ts` maps renderer actions into a shared request function and turns the composer action into a stop control while streaming.
- `src/assistant/assistant.test.ts` is a new jsdom integration suite with injected dependencies to exercise the composer/action event wiring.
- `src/assistant/styles.css` styles user action visibility and the inline editor to match the existing user bubble.

### Task 1: Add immutable user-message replacement to chat state

**Files:**

- Modify: `src/assistant/render/state.ts:16-37, 119-151`
- Modify: `src/assistant/render.test.ts:1-52`

**Interfaces:**

- Produces: `ChatEvent` variant `{ type: "user_edit"; messageId: string; text: string }`.
- Consumes: existing `ChatMessage` union and its `references?: ChatReference[]` field.
- Guarantees: the matching user message receives the new `text`; its `references`, id, and every nonmatching message are unchanged.

- [ ] **Step 1: Write the failing reducer test**

  Add this test after `keeps submitted file and Skill references on the user message` in `src/assistant/render.test.ts`:

  ```ts
  it("replaces one user message text while retaining its references", () => {
    const state = run([
      { type: "user", text: "old", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] },
      { type: "user", text: "later" },
    ]);
    const first = state.messages[0];
    if (first.role !== "user") throw new Error("expected user message");

    const edited = reduceEvents(state, { type: "user_edit", messageId: first.id, text: "new" });

    expect(norm(edited.messages)).toEqual([
      { role: "user", text: "new", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] },
      { role: "user", text: "later" },
    ]);
    expect(edited.messages[1]).toBe(state.messages[1]);
  });
  ```

- [ ] **Step 2: Run the focused test and confirm it fails for the missing event variant**

  Run: `npx vitest run src/assistant/render.test.ts -t "replaces one user message text"`

  Expected: TypeScript/test failure because `user_edit` is not assignable to `ChatEvent`.

- [ ] **Step 3: Add the event variant and minimal reducer branch**

  In the `ChatEvent` union, add:

  ```ts
  | { type: "user_edit"; messageId: string; text: string }
  ```

  In `reduceEvents`, directly after the `case "user"` branch, add:

  ```ts
  case "user_edit":
    return {
      ...state,
      messages: state.messages.map((message) =>
        message.role === "user" && message.id === event.messageId
          ? { ...message, text: event.text }
          : message,
      ),
    };
  ```

- [ ] **Step 4: Run the focused reducer suite**

  Run: `npx vitest run src/assistant/render.test.ts`

  Expected: PASS with the new replacement test and existing reducer tests.

- [ ] **Step 5: Commit the state change**

  ```bash
  git add src/assistant/render/state.ts src/assistant/render.test.ts
  git commit -m "feat: support editing user chat messages"
  ```

### Task 2: Render the correct message actions and inline editor

**Files:**

- Modify: `src/assistant/render/view.ts:13-64, 117-148, 164-183`
- Modify: `src/assistant/blocks.ts:13-72, 110-150`
- Modify: `src/assistant/blocks.test.ts:92-132`
- Modify: `src/assistant/styles.css:85-104, 287-357`

**Interfaces:**

- Produces: bubbling renderer events `chat:user-retry` with `{ messageId }`, `chat:user-edit` with `{ messageId }`, and `chat:user-edit-send` with `{ messageId, text }`.
- Produces: `chat:user-edit-cancel` with `{ messageId }` for testable cancellation and future coordination.
- Consumes: `ChatMessage` user ids and `message.text`; no request or composer APIs.
- Guarantees: assistant text gets a `复制原文` action only when not streaming; users get `重试` and `编辑`; all user actions are disabled during streaming.

- [ ] **Step 1: Replace the old action test with failing renderer tests**

  Replace `renders copy and retry as icon-only actions with accessible labels` in `src/assistant/blocks.test.ts` with these tests:

  ```ts
  it("renders only copy for a completed assistant text block", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const state = run([{ type: "delta", requestId: "r1", text: "answer" }, { type: "done", requestId: "r1" }]);
    reconcileMessages(scroll, state.messages, map);
    expect(Array.from(scroll.querySelectorAll<HTMLButtonElement>(".chat-message-action"))
      .map((button) => button.getAttribute("aria-label"))).toEqual(["复制原文"]);
  });

  it("renders retry and edit actions on a user bubble", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const state = run([{ type: "user", text: "question" }]);
    reconcileMessages(scroll, state.messages, map);
    expect(Array.from(scroll.querySelectorAll<HTMLButtonElement>(".chat-message-action"))
      .map((button) => button.getAttribute("aria-label"))).toEqual(["重试", "编辑"]);
  });

  it("edits a user bubble in place and cancel restores its text", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const state = run([{ type: "user", text: "before" }]);
    reconcileMessages(scroll, state.messages, map);
    scroll.querySelector<HTMLButtonElement>(".chat-edit-btn")!.click();
    const input = scroll.querySelector<HTMLTextAreaElement>(".chat-user-edit-input")!;
    expect(input.value).toBe("before");
    input.value = "after";
    scroll.querySelector<HTMLButtonElement>(".chat-user-edit-cancel")!.click();
    expect(scroll.querySelector(".chat-user-edit-input")).toBeNull();
    expect(scroll.querySelector(".chat-user-message-text")?.textContent).toBe("before");
  });
  ```

- [ ] **Step 2: Run the focused block tests and confirm the assertions fail**

  Run: `npx vitest run src/assistant/blocks.test.ts -t "completed assistant|retry and edit|edits a user"`

  Expected: FAIL because retry remains attached to assistant blocks and user edit controls do not exist.

- [ ] **Step 3: Add message-level user actions and temporary inline editing in `view.ts`**

  Replace `attachRetryButton` with a generic user action helper that dispatches a custom event using the user message id:

  ```ts
  function attachUserAction(textEl: HTMLElement, className: string, label: string, icon: string, messageId: string): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-message-action ${className}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(createIcon({ phosphor: icon, size: 14 }));
    button.addEventListener("click", () => {
      textEl.dispatchEvent(new CustomEvent(className === "chat-retry-btn" ? "chat:user-retry" : "chat:user-edit", {
        bubbles: true,
        detail: { messageId },
      }));
    });
    ensureMessageActions(textEl, "right").appendChild(button);
  }
  ```

  In the user branch of `renderMessage`, replace `attachCopyButton(el, message.text, "right")` with:

  ```ts
  attachUserAction(el, "chat-retry-btn", "重试", "ph ph-arrow-clockwise", message.id);
  attachUserAction(el, "chat-edit-btn", "编辑", "ph ph-pencil-simple", message.id);
  ```

  Add an exported `startUserMessageEdit(messageEl, messageId, initialText)` that replaces `.chat-msg-text` with a textarea and `取消`/`发送` buttons. `取消` restores `.chat-msg-text` with the original text and dispatches `chat:user-edit-cancel`; `发送` trims the textarea, does nothing for empty input, and dispatches `chat:user-edit-send` with `{ messageId, text }`. Make the textarea and buttons use the CSS classes asserted in Step 1.

  In the assistant text block case, only append `attachCopyButton(el, block.text)` when `!streaming`; remove any retry attachment.

- [ ] **Step 4: Reconcile changed user messages and wire edit-start DOM state**

  In `src/assistant/blocks.ts`, when the existing message node is a user message whose `text` differs from the message currently rendered, replace that node with `renderMessage(message)` and update `msgMap`; continue to update assistant blocks in place as today. Export a small `beginUserMessageEdit` wrapper that calls `startUserMessageEdit` for the matching `data-message-id` node.

  This ensures `user_edit` changes the rendered bubble after successful resend while all other message nodes retain their incremental identity.

- [ ] **Step 5: Style user actions and the inline editor**

  Add CSS adjacent to `.chat-msg.chat-user .chat-msg-text`:

  ```css
  .chat-user-edit-shell { min-width: 180px; }
  .chat-user-edit-input {
    box-sizing: border-box;
    width: 100%;
    min-height: 38px;
    resize: vertical;
    padding: 9px 12px;
    border: 1px solid var(--color-border-strong);
    border-radius: 14px 14px 4px 14px;
    background: var(--color-bubble-user-bg);
    color: inherit;
    font: inherit;
    line-height: inherit;
  }
  .chat-user-edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
  ```

  Add `.chat-edit-btn` to the existing retry-button visual rules. Keep both user actions visible on hover/focus, and at `hover: none`, just as copy controls are today.

- [ ] **Step 6: Run all block tests**

  Run: `npx vitest run src/assistant/blocks.test.ts`

  Expected: PASS, including the copy freshness regression and the new message-action tests.

- [ ] **Step 7: Commit the renderer change**

  ```bash
  git add src/assistant/render/view.ts src/assistant/blocks.ts src/assistant/blocks.test.ts src/assistant/styles.css
  git commit -m "feat: add user message retry and inline editing"
  ```

### Task 3: Route user actions through request lifecycle and add stop primary action

**Files:**

- Modify: `src/assistant/assistant.ts:194-266, 369-452, 518-560`
- Create: `src/assistant/assistant.test.ts`

**Interfaces:**

- Consumes: renderer events from Task 2, `ChatEvent.user_edit` from Task 1, existing `AssistantDeps.send`, and optional `AssistantDeps.cancel`.
- Produces: a shared `resendUserMessage(messageId, text, references)` path that dispatches `user_edit` before `pending`, calls `deps.send`, and sets `activeRequestId`.
- Guarantees: the primary icon has `aria-label="停止生成"` while `isChatStreaming(state)`; clicking it calls `deps.cancel(activeRequestId)` rather than opening history or submitting the composer.

- [ ] **Step 1: Add failing integration tests with injected dependencies**

  Create `src/assistant/assistant.test.ts` with a jsdom root and a dependency factory. Include these assertions:

  ```ts
  it("shows stop and cancels the active request while streaming", async () => {
    const cancel = vi.fn();
    const { root, emitAgent } = await mountWithDeps({ cancel });
    emitAgent({ type: "delta", requestId: "r1", text: "partial" });
    const action = root.querySelector<HTMLButtonElement>(".assistant-send")!;
    expect(action.getAttribute("aria-label")).toBe("停止生成");
    action.click();
    expect(cancel).toHaveBeenCalledWith("r1");
  });

  it("resends the selected user message with its references", async () => {
    const send = vi.fn().mockResolvedValue("r2");
    const { root, dispatch } = await mountWithDeps({ send });
    dispatch({ type: "user", text: "again", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] });
    root.querySelector<HTMLButtonElement>(".chat-retry-btn")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(
      { userText: "again", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] }, expect.any(String),
    ));
  });

  it("sends edited user text and replaces the bubble", async () => {
    const send = vi.fn().mockResolvedValue("r3");
    const { root, dispatch } = await mountWithDeps({ send });
    dispatch({ type: "user", text: "before" });
    root.querySelector<HTMLButtonElement>(".chat-edit-btn")!.click();
    const input = root.querySelector<HTMLTextAreaElement>(".chat-user-edit-input")!;
    input.value = "after";
    root.querySelector<HTMLButtonElement>(".chat-user-edit-send")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ userText: "after", references: [] }, expect.any(String)));
    expect(root.querySelector(".chat-user-message-text")?.textContent).toBe("after");
  });
  ```

  Implement `mountWithDeps` in the test using a `subscribe` callback capture and fixed `ChatScope`; expose a test-only `dispatch` by emitting the renderer’s custom events or, if necessary, add an exported `__dispatchForTest` only under the test module. Do not add production-only state merely for tests.

- [ ] **Step 2: Run the integration suite and confirm it fails**

  Run: `npx vitest run src/assistant/assistant.test.ts`

  Expected: FAIL because streaming leaves the composer action in history/send mode and the new renderer events are not handled.

- [ ] **Step 3: Centralize send and resend initiation in `assistant.ts`**

  Extract the post-conversation-resolution section of `submit` into a helper with this shape:

  ```ts
  async function sendTurn(
    conversation: ChatConversation,
    payload: PromptPayload,
    options: { replaceMessageId?: string } = {},
  ): Promise<boolean> {
    const text = payload.userText.trim();
    if (options.replaceMessageId) {
      dispatch({ type: "user_edit", messageId: options.replaceMessageId, text });
    } else {
      dispatch({ type: "user", conversationId: conversation.id, text, references: payload.references });
    }
    dispatch({ type: "pending", conversationId: conversation.id });
    activeRequestId = await deps.send({ ...payload, userText: text }, conversation.id);
    return true;
  }
  ```

  Preserve `submit`’s scope and conversation-token safety checks, title derivation, failure toast, and local draft behavior. Add a `resendUserMessage(messageId, text, references)` wrapper that returns early when there is no active conversation or when `isChatStreaming(state)`, then calls `sendTurn(activeConversation, { userText: text, references }, { replaceMessageId: messageId })`.

- [ ] **Step 4: Handle the new bubbling events**

  Delete the legacy `chat:retry` listener, which backtracks from an assistant block. Add listeners on `scroll`:

  ```ts
  scroll.addEventListener("chat:user-retry", (event) => {
    const { messageId } = (event as CustomEvent<{ messageId: string }>).detail;
    const message = state.messages.find((entry) => entry.role === "user" && entry.id === messageId);
    if (message?.role === "user") void resendUserMessage(message.id, message.text, message.references ?? []);
  });

  scroll.addEventListener("chat:user-edit", (event) => {
    if (isChatStreaming(state)) return;
    const { messageId } = (event as CustomEvent<{ messageId: string }>).detail;
    const message = state.messages.find((entry) => entry.role === "user" && entry.id === messageId);
    const node = scroll.querySelector<HTMLElement>(`.chat-msg[data-message-id="${CSS.escape(messageId)}"]`);
    if (message?.role === "user" && node) startUserMessageEdit(node, message.id, message.text);
  });

  scroll.addEventListener("chat:user-edit-send", (event) => {
    const { messageId, text } = (event as CustomEvent<{ messageId: string; text: string }>).detail;
    const message = state.messages.find((entry) => entry.role === "user" && entry.id === messageId);
    if (message?.role === "user") void resendUserMessage(messageId, text, message.references ?? []);
  });
  ```

  Do not handle `chat:user-edit-cancel` beyond allowing it to restore DOM state; it does not mutate reducer state or invoke a request.

- [ ] **Step 5: Switch the composer primary action to stop mode**

  At the start of `updateSendMode`, branch on `isChatStreaming(state)`:

  ```ts
  if (isChatStreaming(state)) {
    sendBtn.setAttribute("aria-label", "停止生成");
    sendBtn.title = "停止生成";
    sendBtn.innerHTML = `<i class="ph ph-stop"></i>`;
    return;
  }
  ```

  In the `sendBtn` click listener, cancel instead of submitting while streaming:

  ```ts
  sendBtn.addEventListener("click", () => {
    if (isChatStreaming(state)) {
      if (activeRequestId) deps.cancel?.(activeRequestId);
      return;
    }
    composer.submit();
  });
  ```

  Call `updateSendMode()` inside `rerender()` so every pending, delta, done, and error transition updates the primary icon. Also disable `.chat-retry-btn` and `.chat-edit-btn` from `rerender` while streaming; use their native `disabled` property, not CSS alone.

- [ ] **Step 6: Run integration and related feature tests**

  Run: `npx vitest run src/assistant/assistant.test.ts src/assistant/blocks.test.ts src/assistant/render.test.ts`

  Expected: PASS with stop cancellation, resend payload, edited resend, copy-only assistant action, and reducer coverage.

- [ ] **Step 7: Commit the request-lifecycle change**

  ```bash
  git add src/assistant/assistant.ts src/assistant/assistant.test.ts
  git commit -m "feat: control assistant responses from message actions"
  ```

### Task 4: Verify the full frontend surface

**Files:**

- Verify: `src/assistant/assistant.ts`
- Verify: `src/assistant/render/state.ts`
- Verify: `src/assistant/render/view.ts`
- Verify: `src/assistant/blocks.ts`
- Verify: `src/assistant/styles.css`

- [ ] **Step 1: Run the complete frontend test suite**

  Run: `npm run test:frontend`

  Expected: exit code 0 with every Vitest suite passing.

- [ ] **Step 2: Run the frontend TypeScript/build verification**

  Run: `npm run build:frontend`

  Expected: exit code 0 after `tsc` and Vite build complete.

- [ ] **Step 3: Review the final change set for scope and platform safety**

  Run: `git diff HEAD~3..HEAD -- src/assistant docs/superpowers`

  Expected: only frontend assistant action, inline-edit styling, tests, and the design/plan documents; no Tauri protocol, persistence, or platform-specific changes.

- [ ] **Step 4: Record verification in the handoff**

  Report the exact test/build commands and their exit status. Do not claim the change is complete unless both commands from Steps 1 and 2 succeeded in the current session.

## Self-review

- Spec coverage: Task 3 covers stop mode and cancellation; Task 2 covers AI copy-only plus user retry/edit UI; Tasks 1 and 3 preserve references and resend behavior; Task 4 confirms frontend compatibility. All specified requirements are assigned.
- Placeholder scan: this plan contains no TBD/TODO or deferred implementation language.
- Type consistency: `user_edit`, `chat:user-retry`, `chat:user-edit`, and `chat:user-edit-send` are defined once and used with matching payload shapes in their respective tasks.
