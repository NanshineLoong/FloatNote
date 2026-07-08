# AI Chat Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and browse FloatNote AI conversations by project/document scope while keeping Pi session JSONL as the message source of truth.

**Architecture:** Rust owns a lightweight `~/.floatnote/chat-history/index.json` product index and forwards open/new/prompt requests to the Node sidecar. The sidecar opens Pi sessions from `~/.floatnote/chat-history/sessions/`, includes `conversationId` on stream events, and returns a display snapshot when a session opens. The note window keeps only the active scope and active conversation UI state, and a separate history page lists global conversations.

**Tech Stack:** Tauri 2 Rust commands/events, Vanilla TypeScript/Vite frontend, Vitest, Pi Coding Agent SDK `SessionManager`.

## Global Constraints

- Project spaces are folders containing `_inbox.md`, `_tasks.md`, and non-underscore Markdown pieces; conversation scope is project/document, not individual files.
- AI chat data lives under `~/.floatnote/chat-history/` on macOS and Windows user homes.
- Pi SDK JSONL session files are authoritative; `index.json` stores metadata only.
- Sending prompts must use `conversationId` and `userText`, not `activeNote` or `noteText`.
- Switching conversations while streaming must not append events to the wrong visible conversation.
- The first implementation has no search, no summaries, and no project-folder chat history.
- Run `npm test`, `npm run build`, sidecar tests, and `cargo check` before completion.

---

### Task 1: Chat History Index

**Files:**
- Create: `src-tauri/src/chat_history.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `ChatScopeType`, `ChatConversationIndexEntry`, `ChatHistoryStore`, and command helpers for create/list/open/delete/clear.
- Consumes: standard filesystem APIs and `AppState`.

- [ ] **Step 1: Write failing Rust tests**

Add unit tests in `src-tauri/src/chat_history.rs` for:

```rust
#[test]
fn creates_and_reopens_scope_conversation() {
    let dir = tempdir();
    let store = ChatHistoryStore::new_at(dir.path().join("chat-history"));
    let entry = store.create(ChatScopeType::Project, "/tmp/project", "Project").unwrap();
    assert_eq!(entry.scope_path, "/tmp/project");
    assert!(std::path::Path::new(&entry.session_file).ends_with("sessions"));
    let last = store.get_for_scope(ChatScopeType::Project, "/tmp/project").unwrap().unwrap();
    assert_eq!(last.id, entry.id);
}
```

Run: `cd src-tauri && cargo test chat_history --lib`
Expected: FAIL because `chat_history` does not exist.

- [ ] **Step 2: Implement index store**

Implement a store that creates directories, reads/writes `index.json`, backs up corrupt files to `index.json.bak`, generates unique `conversationId`s, creates session paths under `sessions/`, sorts by `lastOpenedAt`/`updatedAt`, deletes session files, and clears entries older than a cutoff.

- [ ] **Step 3: Add Tauri commands**

Expose `chat_get_for_scope`, `chat_create`, `chat_list_for_scope`, `chat_list_recent`, `chat_list_all`, `chat_open`, `chat_delete`, and `chat_clear_before` from `commands.rs`, using `ChatHistoryStore::default_for_user()`.

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo test chat_history --lib`
Expected: PASS.

### Task 2: Protocol and Sidecar Session Routing

**Files:**
- Modify: `sidecar/src/protocol.ts`
- Modify: `sidecar/src/agent.ts`
- Modify: `sidecar/src/main.ts`
- Modify: `sidecar/src/agent.test.ts`
- Modify: `sidecar/src/protocol.test.ts`
- Modify: `src-tauri/src/agent.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Consumes: `conversationId`, `sessionFile`, `sessionDir`, `cwd` from Rust.
- Produces: sidecar events carrying `conversationId`, plus `session_opened` snapshots.

- [ ] **Step 1: Write failing TS and Rust protocol tests**

Update tests so `prompt` requires `{ requestId, conversationId, userText }`, `delta/tool/done/error` include `conversationId`, and `open_session/new_session` decode correctly.

Run: `cd sidecar && npm test -- protocol agent`
Expected: FAIL with type/test mismatches.

- [ ] **Step 2: Extend Rust protocol**

Add `OpenSession`, `NewSession`, and `Prompt { request_id, conversation_id, user_text }` variants. Add `conversation_id` to `Delta`, `Tool`, `Done`, and optional `Error`.

- [ ] **Step 3: Implement sidecar controller**

Create/open Pi sessions with `SessionManager.create(cwd, sessionDir)` and `SessionManager.open(sessionFile)`, cache sessions by `conversationId`, and use `conversationId` when translating stream events. Keep `apply_write` unchanged except for routing through the session that emitted the tool call.

- [ ] **Step 4: Wire command flow**

`agent_send` takes `conversationId` and `userText`, creates a request id, sends the new prompt shape, and no longer accepts note text/path args.

- [ ] **Step 5: Verify**

Run: `cd sidecar && npm test`
Expected: PASS.

Run: `cd src-tauri && cargo test agent --lib`
Expected: PASS.

### Task 3: Assistant Frontend Current-Scope History

**Files:**
- Create: `src/note/chat-history.ts`
- Modify: `src/note/agent.ts`
- Modify: `src/assistant/render.ts`
- Modify: `src/assistant/render.test.ts`
- Modify: `src/assistant/assistant.ts`
- Modify: `src/note/main.ts`
- Modify: `src/assistant/styles.css`

**Interfaces:**
- Consumes: chat history commands and `agent://event`.
- Produces: assistant UI state with active `conversationId`, scope popover, new conversation action, and filtered stream rendering.

- [ ] **Step 1: Write failing reducer tests**

Add tests for loading display snapshots, ignoring deltas for non-active conversations, and replacing the pending bubble only for the matching `conversationId`.

Run: `npm test -- src/assistant/render.test.ts`
Expected: FAIL because reducer lacks active conversation support.

- [ ] **Step 2: Implement chat-history bridge**

Add typed wrappers for chat commands and events in `src/note/chat-history.ts`; update `agentSend` to accept `{ conversationId, userText }`.

- [ ] **Step 3: Update assistant component**

Add `scope`, `loadScopeHistory`, `createConversation`, `openConversation`, and `getConversation` dependencies. Show the clock icon on empty input, show a scrollable current-scope popover, show `新对话` when expanded, create a conversation on first send if needed, and filter events by `conversationId`.

- [ ] **Step 4: Update main note window**

Derive scope from `currentProject` or `currentDocument`, load the last scope conversation after opening a project/document, and pass the scope into the assistant.

- [ ] **Step 5: Verify**

Run: `npm test -- src/assistant/render.test.ts`
Expected: PASS.

### Task 4: Full History Page and Tray Entries

**Files:**
- Create: `history.html`
- Create: `src/history/main.ts`
- Modify: `vite.config.ts`
- Modify: `src/styles.css` or `src/history/styles.css`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: chat list/open/delete/clear commands.
- Produces: a dedicated `history` window and tray recent conversation menu entries.

- [ ] **Step 1: Add history page**

Render all conversations with title, time, scope label, open/delete actions, and a clear-old confirmation.

- [ ] **Step 2: Add window and tray wiring**

Create/show a `history` webview window for `查看全部对话...`. Build tray menu with `最近对话`, up to five recent rows, and a full-history item. Emit a note-window event when opening a conversation from tray/history.

- [ ] **Step 3: Handle open events in note main**

Subscribe to `chat://open`, open/focus the associated project/document where possible, open the conversation, and show an unavailable error if the path is missing.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: PASS.

Run: `cd src-tauri && cargo check`
Expected: PASS.

### Task 5: Final Verification

**Files:**
- All modified files.

**Interfaces:**
- Consumes: implemented feature.
- Produces: verified build/test status.

- [ ] **Step 1: Run frontend tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run sidecar tests**

Run: `cd sidecar && npm test`
Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Run Rust checks**

Run: `cd src-tauri && cargo check`
Expected: PASS.
