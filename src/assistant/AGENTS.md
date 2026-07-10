# src/assistant — AI assistant UI

In-window AI tutor chat surface. Streams sidecar events (`agent://event`)
into a reconciled message list with incremental DOM updates.

## Module map

- `assistant.ts` — `AssistantHandle` connector: builds DOM, wires input/
  submit/history/permission/skills/mentions, subscribes to agent events.
- `render/` — `state.ts` owns the reducer/state machine and `view.ts` owns DOM
  rendering; `index.ts` is the public feature API.
- `blocks.ts` — incremental message-list reconciler (`reconcileMessages`).
- `action-card.ts` — read-only action card (edit/tag diff preview, side-by-side
  with `mod`/`add`/`del`/`ctx` row kinds).
- `permission-bubble.ts` — docked permission bubble for pending edits +
  `EditPreviewDetail` types shared with action-card.
- `markdown.ts` — minimal block markdown renderer using shared Markdown
  primitives, never note internals.
- `mention-picker.ts`, `skill-picker.ts` — docked dropdowns (`/`-mention and
  right-menu skills). Share the docked floating-menu helper.
- `styles.css` — assistant card/bubble/diff/picker styling.

Cross-feature contracts come from `src/platform/`; shared helpers/UI come from
`src/shared/`. Do not import `src/note/` from this feature.
