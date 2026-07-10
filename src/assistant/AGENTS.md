# src/assistant — AI assistant UI

In-window AI tutor chat surface. Streams sidecar events (`agent://event`)
into a reconciled message list with incremental DOM updates.

## Module map

- `assistant.ts` — `AssistantHandle` connector: builds DOM, wires input/
  submit/history/permission/skills/mentions, subscribes to agent events.
- `render.ts` — `ChatEvent`/`Block`/`ChatMessage`/`ChatState` state machine
  (`reduceEvents`) + DOM rendering (`renderMessage`/`renderBlock`). (State
  and view are candidate for further split — see audit notes.)
- `blocks.ts` — incremental message-list reconciler (`reconcileMessages`).
- `action-card.ts` — read-only action card (edit/tag diff preview, side-by-side
  with `mod`/`add`/`del`/`ctx` row kinds).
- `permission-bubble.ts` — docked permission bubble for pending edits +
  `EditPreviewDetail` types shared with action-card.
- `markdown.ts` — minimal block markdown renderer (reuses
  `../note/inline` `renderInline` + shared `escapeHtml`).
- `mention-picker.ts`, `skill-picker.ts` — docked dropdowns (`/`-mention and
  right-menu skills). Share a dock-dropdown pattern (candidate for extract).
- `styles.css` — assistant card/bubble/diff/picker styling.

Shared helpers: `escapeHtml` from `../shared/escape`.
