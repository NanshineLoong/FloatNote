# AI Chat Sessions — Design Spec

**Date:** 2026-07-08
**Status:** Design confirmed, pending written-spec review

## Goal

FloatNote's AI assistant currently keeps chat UI state in memory and the sidecar uses `SessionManager.inMemory()`. Closing or restarting the app loses the visible conversation, and there is no deliberate way to start a fresh conversation, return to the previous one, or browse historical AI discussions.

This design adds lightweight AI session management:

- projects and standalone documents automatically resume their last AI conversation;
- users can start a new conversation from the assistant;
- users can switch among conversations for the current project/document;
- the tray menu exposes recent conversations for quick jumping;
- a dedicated history window shows all conversations and supports deletion/cleanup.

The feature should stay aligned with FloatNote's lightweight desktop workflow. It must not turn the note window into a full chat product, and it must not write private AI history into project Markdown folders.

## Decisions

- **Scope grain:** conversations are associated with a project or standalone document, not individual project files. A project's inbox, tasks, and pieces share the same conversation pool.
- **Storage root:** AI chat data lives under the user's home directory:

  ```text
  ~/.floatnote/
    chat-history/
      index.json
      sessions/
        <pi-session>.jsonl
  ```

  On Windows this maps to `%USERPROFILE%\.floatnote\chat-history\...`. The app may try to set the `.floatnote` directory hidden on Windows, but failure is non-fatal.

- **Session source of truth:** Pi SDK session JSONL files are the authoritative conversation history. FloatNote does not duplicate messages into its own `ConversationMessage[]` store.
- **FloatNote index:** `index.json` is a lightweight product index for tray/history UI: title, time, scope, and session file path.
- **Prompt payload:** sending a message does not pass `activeNote` or `noteText`. The prompt payload is `conversationId` plus `userText`; the sidecar resolves the matching Pi session.
- **Autosave:** sending does not coordinate with editor autosave.
- **Streaming switch:** switching conversations while a request is streaming does not cancel the request. The sidecar may keep multiple Pi sessions alive; events are routed by request/conversation id, not blindly appended to the currently visible conversation.
- **Assistant history entry:** when the assistant input is empty, the send button becomes a current-scope history button. It opens a small scrollable history popover above the input.
- **New conversation entry:** `新对话` appears in the assistant bubble's upper-right corner when the bubble is open, in both inline and floating modes. No close button is added.
- **History window:** all-conversation history is a dedicated window, not part of settings.
- **Tray menu:** the tray right-click menu shows recent conversations and `查看全部对话...`; it does not include an `打开 FloatNote` item.

## Current Architecture

- Frontend assistant UI lives in `src/assistant/assistant.ts` and uses pure chat rendering state from `src/assistant/render.ts`.
- Frontend-to-host bridge functions live in `src/note/agent.ts`; `agentSend` currently sends `dir`, `noteId`, `path`, `noteText`, and `userText`.
- Rust host sidecar lifecycle and JSONL forwarding live in `src-tauri/src/agent.rs`.
- Tauri commands for `agent_send`, assistant state, and active-note handling live in `src-tauri/src/commands.rs`.
- Sidecar agent runtime lives in `sidecar/src/agent.ts`; it currently creates one Pi session with `SessionManager.inMemory()`.
- The Pi SDK already supports persistent sessions, opening a specific session file, listing sessions, and session replacement through `AgentSessionRuntime`. FloatNote uses these primitives but keeps its own product index and request routing.

## Interaction Design

### Assistant Input Actions

The assistant input has two button states:

1. Empty input: the button shows a history/clock-style icon and opens the current-scope history popover.
2. Non-empty input: the button shows the send icon and sends the message.

This keeps project history reachable even when no conversation bubble is currently expanded. The button should expose a tooltip such as `查看项目对话历史` in the empty state and `发送` in the non-empty state.

When the assistant bubble is open, it shows a compact `新对话` action in the upper-right corner. The action creates a new conversation in the current project/document scope and switches the assistant view to it. Inline and floating modes use the same placement and semantics.

### Scope History Popover

The empty-input history button opens a small popover above the assistant input. It lists conversations for the current scope only and can scroll when there are more rows than fit comfortably. Each row shows:

- title;
- last updated time;
- associated project/document label when useful for disambiguation.

Selecting a row opens/expands the assistant bubble, opens that Pi session in the sidecar, receives a display-message snapshot, renders that conversation in the assistant, and closes the popover.

If the current scope has no conversations, the popover shows an empty state instead of opening a separate history window.

### Tray Recent Conversations

The tray menu contains a `最近对话` section. Rows show:

- title;
- time;
- associated project or document.

Clicking a row opens/focuses the main note window, switches to the associated project/document, opens the selected Pi session, and renders that conversation in the assistant.

If the associated path no longer exists, the row remains visible but opens an error state explaining that the project/document is unavailable. The user can delete the conversation from the full history window.

### Full History Window

`查看全部对话...` opens a dedicated history window. It lazily loads the global index and renders rows with:

- title;
- time;
- associated project/document.

The first version supports:

- opening a conversation;
- deleting one conversation;
- clearing old conversations through a confirmation flow.

The window is separate from settings because it manages user data rather than application preferences.

## Data Model

### `~/.floatnote/chat-history/index.json`

`index.json` stores an array of conversation metadata plus schema version:

```ts
interface ChatHistoryIndex {
  version: 1;
  conversations: ChatConversationIndexEntry[];
}

interface ChatConversationIndexEntry {
  id: string;
  sessionFile: string;
  scopeType: "project" | "document";
  scopePath: string;
  scopeLabel: string;
  title: string;
  titleState: "final" | "temporary";
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}
```

The index is optimized for UI listing. It is not the source of message truth. If an indexed session file is missing, the UI marks the row unavailable instead of failing startup.

### Pi Session Files

Pi SDK JSONL session files under `~/.floatnote/chat-history/sessions/` store the real conversation tree. The app opens/switches them through Pi SDK APIs instead of parsing or rewriting the message stream for normal chat operation.

FloatNote may read session metadata for title fallback or diagnostics, but it should not fork its own incompatible session format.

## Title Rules

When a new conversation receives its first user message:

- if the message is 10 characters or fewer after trimming, use it as the final title;
- otherwise use the first 10 characters as a temporary title and asynchronously ask the model to generate a short title;
- if title generation fails, keep the temporary title.

The title request must update only `index.json`; it must not add visible user/assistant messages to the Pi session.

## Sidecar Design

Replace the single in-memory session with a session controller built on Pi SDK persistent sessions. The controller may use `AgentSessionRuntime` for new/open/switch flows, but it must not assume there is only one live session when requests are streaming.

The sidecar owns:

- a cache of open Pi sessions keyed by `conversationId`;
- the currently visible/default `conversationId`;
- request-to-session mapping for in-flight streams;
- custom session directory `~/.floatnote/chat-history/sessions`;
- title-generation helper for long first messages.

When the user switches visible conversations while another request is streaming, the sidecar keeps the streaming session alive until completion. It can evict idle cached sessions later, but never disposes a session that has an in-flight request.

Relevant protocol changes:

```ts
type HostToSidecar =
  | { type: "configure"; provider: string; model: string; apiKey?: string; baseUrl?: string }
  | { type: "open_session"; conversationId: string; sessionFile: string }
  | { type: "new_session"; conversationId: string; cwd: string; sessionDir: string }
  | { type: "prompt"; requestId: string; conversationId: string; userText: string }
  | { type: "cancel"; requestId: string };

type SidecarToHost =
  | { type: "ready" }
  | { type: "session_opened"; conversationId: string; sessionFile: string; messages: ChatDisplayMessage[] }
  | { type: "delta"; requestId: string; conversationId: string; text: string }
  | { type: "tool"; requestId: string; conversationId: string; name: string; phase: "start" | "end" }
  | { type: "done"; requestId: string; conversationId: string }
  | { type: "title"; conversationId: string; title: string }
  | { type: "error"; requestId: string | null; conversationId?: string; message: string };

type ChatDisplayMessage =
  | { role: "user"; text: string; timestamp: number }
  | { role: "assistant"; text: string; timestamp: number }
  | { role: "tool"; label: string; timestamp: number }
  | { role: "error"; text: string; timestamp: number };
```

`ChatDisplayMessage[]` is a display projection of the Pi session branch, not a second message store. It is derived when opening a session so the frontend can render historical messages without parsing Pi JSONL itself.

The current `read_note`/`write_note` tools can remain for now, but this design does not bind them to a request-scoped active note. They operate on whatever FloatNote currently considers the active note when the tool is invoked. A stricter request-scoped note binding can be designed later if AI write safety becomes a priority.

## Rust/Tauri Design

Add a Rust module such as `src-tauri/src/chat_history.rs` for index management:

- create the `~/.floatnote/chat-history/` directory;
- create/read/write `index.json`;
- add/update entries;
- list recent entries;
- list all entries with cursor/limit;
- delete an entry and its session file;
- clear old entries by timestamp;
- resolve scope availability.

Commands:

| Command | Purpose |
|---|---|
| `chat_get_for_scope(scopeType, scopePath)` | Return the last-opened conversation for a scope, or `null` when no conversation exists yet. |
| `chat_create(scopeType, scopePath, scopeLabel)` | Create a new conversation index entry and ask sidecar to create a Pi session. |
| `chat_list_for_scope(scopeType, scopePath)` | List current project/document conversations. |
| `chat_list_recent(limit)` | Feed tray recent conversations. |
| `chat_list_all(cursor, limit)` | Feed full history window lazy loading. |
| `chat_open(conversationId)` | Mark opened, return metadata/session file, and coordinate sidecar session switch. |
| `chat_delete(conversationId)` | Delete index entry and session file. |
| `chat_clear_before(timestamp)` | Delete conversations older than a cutoff after user confirmation. |

Tray wiring belongs near `src-tauri/src/tray.rs`; window creation for full history belongs near `src-tauri/src/windows.rs`.

## Frontend Design

Add a small chat-history frontend boundary, for example `src/note/chat-history.ts`, wrapping Tauri commands.

Assistant component changes:

- accept current conversation metadata as state;
- switch the input action button between current-scope history and send based on whether the input is empty;
- render a scrollable current-scope history popover above the input;
- render `新对话` in the assistant bubble's upper-right corner when the bubble is open;
- render messages from the active Pi session view;
- attach stream deltas by `conversationId`;
- ignore or badge stream events for non-visible conversations instead of appending them to the visible chat;
- refresh title when a `title` event arrives.

Main note window changes:

- derive `scopeType/scopePath/scopeLabel` when opening a project or document;
- load the scope's last conversation when one exists, otherwise show an empty assistant ready to create a session on first send;
- handle tray/history open requests by opening the associated project/document, then switching conversation.

Add a Vite/Tauri page for full history, such as `history.html` with `src/history/main.ts`, if a separate window is cleaner than overloading `settings.html`.

## Error Handling

- **Missing project/document:** keep history visible, mark path unavailable, and show a clear error on open.
- **Missing session file:** mark conversation unavailable; deletion still works.
- **Corrupt index:** preserve the corrupt file as a `.bak` copy when possible, start with an empty index, and surface a non-blocking error.
- **Sidecar unavailable:** history browsing still works; opening/sending chat shows the existing assistant connection error.
- **Streaming while switching:** request keeps running in its original cached session; events continue to carry the original `conversationId`; visible UI updates only when it matches the selected conversation.
- **Title generation failure:** keep the temporary first-10-character title.

## Non-Goals

- No project-folder chat history in the first version.
- No search in the first version.
- No summaries in list rows.
- No per-piece/per-inbox conversation separation.
- No full Pi tree UI in FloatNote. Pi sessions may internally contain branches, but FloatNote's first history UI treats each session file as one conversation.
- No request-scoped active-note safety for `read_note`/`write_note` in this design.

## Testing

### Rust

- `chat_history` path resolution on Unix and Windows-style home paths.
- index create/read/write roundtrip.
- list recent sorting by `updatedAt`/`lastOpenedAt`.
- list all cursor pagination.
- delete removes index entry and session file.
- clear-before removes only eligible conversations.
- corrupt index fallback creates a usable empty index.

### Sidecar

- creates persistent sessions in the configured custom session directory.
- opens existing sessions and returns display-message snapshots.
- keeps an in-flight session alive when the visible conversation changes.
- routes streaming events with `conversationId`.
- allows switching visible sessions while an old request continues.
- emits title updates for long first messages.

### Frontend

- empty assistant input renders the history action instead of send.
- non-empty assistant input renders the send action.
- current-scope history popover opens above the input, scrolls, and opens the selected conversation.
- `新对话` renders in the assistant bubble's upper-right corner in inline and floating modes.
- new conversation clears the visible chat and selects the new conversation.
- non-visible stream deltas do not mutate the visible conversation.
- full history window paginates and opens a conversation.

### Manual

- macOS and Windows path behavior for `~/.floatnote`.
- tray recent conversation opens the correct project/document and conversation.
- full history deletion and cleanup confirm before destructive actions.
- app restart resumes the last conversation for a project/document.
