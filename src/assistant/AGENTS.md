# src/assistant — AI assistant UI

In-window AI tutor chat surface. Streams sidecar events (`agent://event`)
into a reconciled message list with incremental DOM updates.

## Module map

- `assistant.ts` — `AssistantHandle` connector: builds DOM, wires input/
  submit/history/permission/skills/mentions, subscribes to agent events.
- `render/` — `state.ts` owns the reducer/state machine and `view.ts` owns DOM
  rendering; `index.ts` is the public feature API. Assistant state always keeps
  complete ordered text/thinking/tool blocks. Two or more consecutive process
  items form a `process_group`; only text ends a group. Compact/detailed output
  modes are projections and must not discard state.
- `blocks.ts` — incremental message-list reconciler (`reconcileMessages`).
- `action-card.ts` — read-only action card (edit/tag diff preview, side-by-side
  with `mod`/`add`/`del`/`ctx` row kinds).
- `permission-bubble.ts` — docked permission bubble for pending edits +
  `EditPreviewDetail` types shared with action-card.
- `markdown.ts` — minimal block markdown renderer using shared Markdown
  primitives, never note internals.
- `input/` — the CM6 assistant composer: atomic file/skill chips, unified
  caret-following candidate popover, structured clipboard/send payload, and
  the body-level focused-paper portal. The portal moves the existing input
  host into its modal paper and restores it to the current dock; it must never
  create a second `EditorView`. Enter submits in compact mode but inserts a
  newline in the focused paper, where only the send button submits. Composer
  submission is asynchronous: clear and
  collapse only after `send` returns a request id, while failures retain the
  draft. If the user edits while that handshake is pending, the newer live
  draft wins and is not cleared by the older completion. `mention-picker.ts`
  and `skill-picker.ts` remain the data-type sources
  for the composer; their legacy textarea menus are no longer mounted by
  `assistant.ts`.
- `styles.css` — assistant card/bubble/diff/picker styling.

Tool rows use the sidecar-provided safe `label` and stable `callId`; never render
raw tool arguments or result bodies. Compact mode is the default and owns the
streaming cursor. Detailed mode owns process shimmer and expandable groups.

Cross-feature contracts come from `src/platform/`; shared helpers/UI come from
`src/shared/`. Do not import `src/note/` from this feature.
