# Permission Review Card and Dialog Design

## Status

Approved design. Implementation plan pending.

## Goal

Redesign the assistant's write-permission UI so each pending operation first
appears as a compact card containing one semantic title and a footer of approval
controls. Document creation and document edits additionally expose a `查看`
action that opens a focused, paper-like dialog with the complete proposed
content. Creation uses a rendered Markdown preview; edits and whole-document
rewrites use a real side-by-side line diff.

The result should make routine approvals quick, keep detailed content out of the
compact card until requested, preserve the existing write and snapshot
semantics, and visually align the card with the complete assistant dock rather
than only the text input.

## Current State

The main permission surface is the docked bubble in
`src/assistant/permission-bubble.ts`. `permission://request` is dispatched to
the chat reducer, but `fillActionBlock()` intentionally leaves permission data
out of the conversation flow, and `action-card.ts` renders every tool action as
a read-only process row. Consequently the docked bubble is the normal approval
surface, not merely an exceptional fallback. This design preserves that
boundary.

The current bubble has several issues addressed here:

- It renders a generic tool label, a separate summary, and a detail body. For
  example, creating a document repeats `创建文档` and
  `创建文档「filename」`; editing repeats `编辑文本` and `编辑后的内容`.
- It shows content directly in the compact surface, making the card taller and
  wider than necessary.
- `.assistant-perm-region` uses a fixed `360px` target width rather than
  following the combined AI-avatar/input/send dock geometry.
- `create_note` preview detail carries only a 240-character `contentPreview`,
  even though the same request already carries the complete `new_content`.
- `edit_note` and `write_note` requests already contain complete `old_content`
  and `new_content`, but the bubble renders only the proposed new Markdown.
- The sidecar's current `unifiedDiff()` compares equal line indexes. Inserting
  or removing one line can therefore mark the remaining document as changed.
  It is unsuitable for a formal review dialog.
- `write_note` currently uses a standalone select followed by an allow button.
  It does not provide the requested direct-write primary action with a snapshot
  alternative behind a dropdown arrow.

The existing focused assistant input already provides the desired visual and
behavioral reference in `src/assistant/input/overlay.ts`: a body-level modal
layer, dimmed backdrop, centered paper, background `inert`, Escape handling,
focus containment, and focus restoration.

## Confirmed Product Decisions

1. The compact card contains exactly two visual rows: one single-line title and
   one footer row of controls. It contains no summary, preview body, diff,
   snapshot select, or inline error message.
2. The footer places optional `查看` on the left. `拒绝` and `允许写入` are
   adjacent on the right, with `允许写入` always rightmost.
3. Only `create_note`, `edit_note`, and `write_note` expose `查看`. Tag
   operations express all necessary information in their title.
4. The card spans the complete assistant dock: its left edge aligns with, or
   sits just inside, the AI avatar's left edge; its right edge aligns with, or
   sits just inside, the send button's right edge. It is not limited to the
   input-field width.
5. The detail surface is an in-window paper dialog, not a new Tauri window.
6. Creating a document shows its complete proposed Markdown. Editing or
   rewriting a document shows a side-by-side diff.
7. Closing the dialog, including with Escape, only returns to the pending card.
   It never implies denial.
8. A snapshot-capable `write_note` uses a split allow control. Clicking the
   main `允许写入` segment immediately approves a direct write. Clicking the
   arrow opens a menu; clicking `保存快照后写入` immediately approves and
   executes in snapshot mode, with no second confirmation.
9. The card and dialog are two views of one pending request and one resolution
   state. They must not be able to submit duplicate decisions.

## Compact Card Design

### Layout

The card is anchored above `.assistant-dock` and follows the dock's horizontal
inset. The implementation should express that inset once, for example through
an assistant CSS custom property used by both dock padding and the permission
region, rather than maintaining unrelated pixel values.

Conceptually:

```text
┌───────────────────────────────────────────────────────┐
│ 编辑「piece.md」                                      │
│                                                       │
│ [查看]                         [拒绝] [允许写入]       │
└───────────────────────────────────────────────────────┘
  [AI avatar]  [assistant input................] [send]
```

For `write_note`, the rightmost control becomes:

```text
[拒绝] [允许写入 | ▾]
```

The title remains one visual line. Long dynamic fragments are truncated with
an ellipsis and retain their complete value as an accessible label or tooltip.
The footer must not wrap the decision buttons into separate rows under normal
supported assistant widths. If the entire assistant surface becomes unusually
narrow, the title may truncate more aggressively before the footer wraps.

### Title Projection

Titles are derived in the frontend from the structured request detail rather
than displaying `preview.summary`. This removes duplication and keeps wording
consistent.

| Tool | Title | View |
| --- | --- | --- |
| `create_note` | `创建「Ideas.md」` | Yes |
| `edit_note` | `编辑「piece.md」` | Yes |
| `write_note` | `覆写「piece.md」` | Yes |
| `tag_create` | `新建标签「重点」` plus its color chip | No |
| `set_tag` | `为「块摘要」设置标签「重点」` plus its color chip | No |
| `set_tag` clearing a tag | `清除「块摘要」的标签` | No |
| `tag_update` | `修改标签「旧名称」→「新名称」` with old/new color cues | No |
| `tag_delete` | `删除标签「重点」并清除 3 处标记` | No |

The Rust permission payload already includes `resolved_note_id` and
`resolved_path`, although the frontend `PermissionRequest` mirror does not
declare them. The frontend type should add those fields. Document display names
prefer the basename of `resolved_path`, parsing both `/` and `\` separators;
they fall back to the structured target, then `resolved_note_id`, then a generic
`当前文档`. Full machine paths are never rendered.

Tag color dots or chips are inline title content, not a separate detail row.
They must include accessible text so color is not the only carrier of meaning.

### Control Semantics

- `查看` is a low-emphasis action and opens the dialog for the current request.
- `拒绝` calls the shared resolver with `{ decision: "deny", writeMode:
  "direct" }`.
- A normal `允许写入` calls the resolver with `{ decision: "allow",
  writeMode: "direct" }`.
- A snapshot-capable `write_note` renders `允许写入` as a split button. Its
  main segment performs the normal direct approval. Its arrow segment has
  `aria-haspopup="menu"`, reports `aria-expanded`, and opens a shared
  `createMenu()` surface containing one action: `保存快照后写入`.
- Selecting `保存快照后写入` immediately calls the resolver with
  `{ decision: "allow", writeMode: "snapshot" }`; it does not merely change a
  stored mode and does not require another click.
- The main segment and arrow are one visual control with a shared outline,
  adjacent radii, and a divider. The arrow's accessible name is
  `其他写入方式`.
- When resolution starts, all card and dialog controls for the request are
  disabled together. The resolver accepts only the first decision.

The split control should be permission-specific and composed from the existing
shared button and menu primitives. It does not require widening the global
`createButton()` API.

## Detail Dialog Design

### Shared Paper Shell

The dialog reuses the focused input's paper dimensions and visual tokens:

- fixed body-level modal layer and backdrop;
- paper width approximately `min(920px, calc(100vw - 32px))`;
- paper height approximately `min(720px, calc(100vh - 64px))`;
- responsive minimum sizing without a second Tauri window;
- background content made `inert` while open;
- focus trapped within the paper;
- focus restored to the `查看` button after a non-resolving close;
- close button in the top-right and Escape support;
- backdrop clicks do not approve, deny, or close the request accidentally.

The paper is divided into a fixed header, a scrollable body, and a fixed
footer. The header places the same semantic title at top-left and an icon-only
close action at top-right. The footer uses the same control components and
ordering as the compact card, except it does not repeat `查看`:

```text
                                      [拒绝] [允许写入]
```

or, for snapshot-capable `write_note`:

```text
                                  [拒绝] [允许写入 | ▾]
```

### Create-Document Preview

`create_note` uses the request's complete `new_content`, never
`detail.contentPreview`. The body renders it with the assistant Markdown
renderer inside a centered readable article column. The body is read-only; the
user is approving or rejecting the proposal, not editing it in this iteration.
Empty content shows a restrained `空文档` state rather than a blank or broken
paper.

### Side-by-Side Edit Diff

`edit_note` and `write_note` use the request's complete `old_content` and
`new_content`. They do not trust the current sidecar `detail.hunks` for formal
alignment.

The dialog computes a proper line diff in the frontend using the `diff` package
as an explicit root dependency, starting from its line-diff API. The exact API
signature must be verified against the current official documentation during
implementation, per the repository guidelines. The dependency remains
frontend-only and pure JavaScript; no Rust protocol or filesystem behavior
changes.

The rendered diff uses one scroll container containing a two-column CSS grid,
not two independently scrolling columns. Each logical diff row owns its old and
new cells, which guarantees vertical alignment even when prose wraps:

- unchanged line: same content in both cells;
- removed line: old content on the left, blank cell on the right;
- added line: blank cell on the left, new content on the right;
- replacement group: removed and added lines paired in order, with blank cells
  for an unequal number of lines;
- deleted content: neutral muted background and strike-through;
- added content: subtle accent background;
- meaning is also conveyed by column labels and row state, never color alone.

`原版本` and `新版本` column labels stay visible while the body scrolls.
Unchanged spans around a change retain a small context window. A longer
unchanged span becomes one full-width row such as
`… 省略 28 行未修改内容`; activating it expands that span in place. This keeps
large documents reviewable without hiding any content permanently.

At narrow widths the diff remains side-by-side, as selected in the design
review. The grid gets a practical minimum width and the body permits horizontal
scrolling rather than switching to a unified layout. Wrapped text remains
aligned because both cells participate in the same grid row.

## Component Architecture

The feature should be separated into small modules with explicit contracts:

```text
src/assistant/
  permission-bubble.ts        Pending-request controller + compact card
  permission-model.ts         Pure title/view/snapshot projection
  permission-dialog.ts        Paper dialog composition + preview body
  permission-diff.ts          Pure line-diff rows + context folding
  permission-allow-button.ts  Normal/split approval control

src/shared/ui/
  modal-paper.ts              Shared modal layer, inert/focus/portal lifecycle
```

Responsibilities:

- `permission-bubble.ts` remains the public mounting API used by
  `assistant.ts`. It owns `currentRequest`, `resolving`, the compact view, and
  one dialog instance. It is the only component allowed to initiate
  resolution.
- `permission-model.ts` transforms a `PermissionRequest` into presentation
  data without DOM or Tauri dependencies. This is where title wording,
  cross-platform basename handling, `canView`, and split-button eligibility are
  tested.
- `permission-dialog.ts` receives presentation data and content plus callbacks.
  It never invokes Tauri directly.
- `permission-diff.ts` accepts old and new strings and returns a render-neutral
  row model. DOM rendering, colors, and control wiring stay outside it.
- `permission-allow-button.ts` accepts `canSnapshot`, `disabled`, and one
  `resolve(writeMode)` callback. The compact card and dialog instantiate the
  same component.
- `modal-paper.ts` extracts the generic lifecycle currently embedded in
  `input/overlay.ts`: layer/paper creation, inert snapshots, Escape policy,
  focus containment, registered modal portal roots, focus restoration,
  open/close, and cleanup. Registered portal roots are required because the
  shared menu is body-hosted: the snapshot menu must remain interactive and
  participate in the dialog's focus boundary without making unrelated body
  content active. The existing input overlay continues moving its single
  CodeMirror host but delegates modal mechanics to this primitive. Its current
  behavior and tests must remain unchanged.

This is a targeted extraction required to keep the two paper surfaces
consistent. It should not expand into a general redesign of unrelated menus or
dialogs.

## Data and State Flow

```text
permission://request
        |
        v
mountPermissionBubble.show(request)
        |
        +--> compact card
        |
        +--> 查看 --> permission dialog (same request)
                         |
compact/direct ----------+
compact/snapshot --------+--> resolve once
dialog/direct -----------+       |
dialog/snapshot ---------+       v
dialog/deny -------------+  assistant.ts resolvePermission
compact/deny ------------+       |
                                 v
                         invoke("resolve_permission")
                           |                  |
                        success             failure
                           |                  |
                  close dialog/card     keep request pending
                                        re-enable controls
                                        show toast
```

The existing backend is already idempotent when a request ID is no longer in
`pending_edits`, but the frontend must still prevent duplicate interaction. A
local resolving guard is the user-facing source of truth; backend idempotency is
only a safety net.

Resolution success clears the compact card, closes the dialog and destroys its
menu. Resolution failure leaves the request pending, re-enables both views, and
uses the existing toast system for feedback. The compact card therefore remains
strictly `title + controls`, including in error cases.

The read-only tool/action row in the conversation remains unchanged. Tool end
events continue to update that row independently after the permission result is
returned to the sidecar.

## Accessibility and Interaction Details

- The paper uses `role="dialog"`, `aria-modal="true"`, and an accessible name
  tied to its visible title.
- The close button, view button, split arrow, snapshot menu item, reject button,
  and allow button are all reachable by keyboard in natural order.
- Opening the snapshot menu moves focus to its first enabled item. Escape closes
  the menu and returns focus to the arrow before a subsequent Escape may close
  the dialog.
- A body-hosted snapshot menu registers its root with `modal-paper` for the
  duration of the menu. The modal's inert and focus logic treats that root as
  inside the dialog, then unregisters it during menu teardown.
- Opening the dialog stores the previously focused element. A normal close
  restores focus to `查看`; a successful resolution does not restore focus to a
  removed card.
- Dialog and menu teardown remove document-level listeners and restore every
  background element's previous `inert` state.
- Full titles remain available to assistive technology even when visually
  truncated.
- Diff semantics are exposed through text labels for old/new, added/removed,
  and collapsed unchanged regions; color is supplementary.
- Reduced-motion preferences suppress card/dialog entrance animations.

## Error Handling

- Failure to invoke `resolve_permission`: keep the request and dialog state,
  restore all controls, close any split menu, and show a toast with the error.
- Diff computation failure: keep the dialog usable and fall back to a plain
  two-column old/new document view. Approval controls remain available because
  review rendering must not strand the backend pending request.
- Empty old or new content: render valid empty cells and preserve addition or
  deletion semantics.
- A missing display filename: use `当前文档`; never show `undefined`, a raw
  internal tool name, or a full machine path.
- A request replaced during teardown: all callbacks verify the current request
  ID before mutating or resolving state.

The sidecar currently waits for each permission result before completing the
tool call, so concurrent permission requests are not a primary product flow.
This design keeps the existing single-current-request behavior and does not add
a permission queue.

## Cross-Platform Impact

The feature is frontend-only except for exposing fields already present in the
Rust event payload through the TypeScript mirror. The dialog remains inside the
existing webview, avoiding macOS/Windows differences in native child windows,
focus, always-on-top behavior, and window decorations.

Path display logic must handle both `/` and `\`. Layout must be checked under
macOS and Windows font metrics and at narrow webview sizes. Scrollbars may look
different by platform, but no platform-specific CSS or API is required.

## Testing and Verification

### Pure unit tests

- title projection for every `EditPreviewDetail` kind;
- active-document and explicit-target filename fallbacks;
- Windows and POSIX basename parsing;
- `canView` only for `create_note`, `edit_note`, and `write_note`;
- snapshot eligibility only for snapshot-capable `write_note`;
- line insertion, deletion, replacement, repeated lines, empty content, and
  unequal replacement groups in the diff row model;
- context folding and expansion boundaries.

### DOM unit tests

- compact cards contain one title and one footer, without summary/detail
  content;
- optional `查看` and right-aligned `拒绝` / `允许写入` ordering;
- direct allow invokes exactly once with `direct`;
- split arrow alone does not resolve;
- snapshot menu selection invokes exactly once with `snapshot` and needs no
  second confirmation;
- resolving disables card and dialog controls together;
- dialog opens with complete create content, not the 240-character preview;
- side-by-side rows remain paired and collapsed context expands in place;
- close button and Escape keep the compact request pending;
- focus trap, inert restoration, menu Escape priority, focus restoration, and
  listener cleanup;
- resolution failure re-enables controls and reports through the error callback.

### Integration and visual verification

- `assistant.ts` receives a real `permission://request`, shows the card, opens
  the dialog, and sends the exact direct/snapshot/deny invoke payload;
- the card aligns with the complete AI-avatar/input/send dock in inline and
  floating assistant modes;
- the paper matches the focused input surface and remains usable at supported
  narrow sizes;
- creation Markdown and long side-by-side diffs scroll without clipping;
- macOS and Windows window resizing preserve access to the header, footer,
  close action, and diff content.

Run `npm test`, `npm run build`, and `npm run review:ui`. Exercise the affected
flow with `npm run tauri dev`; where a Windows environment is available, repeat
the resize, keyboard, menu, and scrollbar checks there.

## Documentation Impact

Implementation adds assistant modules and a shared UI primitive, so update
`src/assistant/AGENTS.md` and the relevant frontend architecture documentation
with focused module-map changes. No stable backend command/event contract is
changed: `permission://request` already contains the required full content and
resolved identifiers.

## Non-Goals

- Editing the proposed document inside the review dialog.
- Moving permission approval back into conversation action rows.
- Creating a native Tauri review window.
- Adding a multi-request permission queue.
- Changing backend write, snapshot, or file-path authorization semantics.
- Replacing the compact/detailed assistant output-mode design.
