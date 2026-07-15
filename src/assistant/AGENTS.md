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
- `permission-bubble.ts` — FIFO pending-request controller and compact dock
  card; it is the only permission surface that initiates resolution. Concurrent
  requests are deduplicated by request id and advance only after the current
  request resolves.
- `permission-model.ts` — pure semantic title, filename, view, and snapshot
  projection. `EditPreviewDetail` and permission payload types live here and
  are re-exported by `permission-bubble.ts` for compatibility.
- `permission-dialog.ts` — complete create-Markdown and edit/rewrite review
  paper. Edit/rewrite review defaults to the aligned source diff and can switch
  to a rendered new-version preview; `permission-diff.ts` supplies line rows
  and context folding.
- `permission-allow-button.ts` — normal/split approval control. Snapshot mode
  is an immediate menu action, not a stored select value.
- `markdown.ts` — compatibility re-export of the safe GFM renderer in
  `src/shared/markdown/render.ts`. Assistant and user bubbles plus permission
  previews all use the shared `.fn-markdown` surface; never import note
  internals for read-only rendering.
- `input/` — the CM6 assistant composer: atomic file/skill chips, unified
  caret-following candidate popover, structured clipboard/send payload, and
  the body-level focused-paper portal. Its modal lifecycle is shared with the
  permission review paper through `src/shared/ui/modal-paper.ts`. The portal moves the existing input
  host into its modal paper and restores it to the current dock; it must never
  create a second `EditorView`. Enter submits in compact mode but inserts a
  newline in the focused paper, where only the send button submits. Composer
  submission is asynchronous: clear and
  collapse only after `send` returns a request id, while failures retain the
  draft. If the user edits while that handshake is pending, the newer live
  draft wins and is not cleared by the older completion. `mention-picker.ts`
  and `skill-picker.ts` remain the data-type sources
  for the composer; their legacy textarea menus are no longer mounted by
  `assistant.ts`. The editor uses the shared GFM language contract and
  lightweight source-preserving decorations from `src/shared/markdown/editor.ts`;
  tables and task lists stay editable Markdown rather than becoming widgets.
- `styles.css` — assistant card/bubble/diff/picker styling.

Tool rows use the sidecar-provided safe `label` and stable `callId`; never render
raw tool arguments or result bodies. Compact mode is the default and owns the
streaming cursor. Detailed mode owns process shimmer and expandable groups.

Cross-feature contracts come from `src/platform/`; shared helpers/UI come from
`src/shared/`. Do not import `src/note/` from this feature.
