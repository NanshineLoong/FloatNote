# Assistant Input Composer Design

## Goal

Rebuild FloatNote's assistant (AI) input box from a plain `<textarea>` with
pure-text `@mention` / `/skill` insertion into a CodeMirror 6 composer with a
structured reference-segment document model, atomic chip widgets, a unified
caret-following candidate popover, an in-app large-input overlay that shares the
same editor state, and a structured send payload that extends the sidecar
protocol. The change must be unified, stable, and extensible — not feature-by-
feature patches — and must ship as one complete, verified change covering file
references, skill invocation, candidate-list interaction, long-text editing,
large-input mode, and state synchronization.

## Context and current state

The assistant input is a native `<textarea>` in `src/assistant/assistant.ts`
(`submit()` at `assistant.ts:199-227`, `autosize()` at `184-188`, keydown at
`306-311`). `@` file mentions (`src/assistant/mention-picker.ts`) and `/` skill
invocations (`src/assistant/skill-picker.ts`) both share `dock-dropdown.ts` for
their dropdown lifecycle but only insert **plain text** — `@name ` or
`/skill:name ` — into the textarea. There is no structured reference/skill DTO:
the sidecar `prompt` message is `{ requestId, conversationId, userText }`
(`sidecar/src/protocol.ts:29-34`) and `runner.prompt()` passes `userText`
verbatim to Pi `session.prompt` (`sidecar/src/runner.ts:105-134`); `/skill:name`
is expanded by Pi and `@name` is a literal token with no resolution.

There is no reference chip, no large-input mode, no IME composition guard, and no
custom undo/redo for the input. CodeMirror 6 is already a project dependency and
is used for the note body editor (`src/note/editor.ts`), so the team has prior CM6
experience (including known gotchas: nested contenteditable widgets do not work,
and line-decoration vertical spacing must be padding, not margin). The reusable
`.tag-chip` style lives in `src/assistant/styles.css:984-993` and the data
sources already exist: `assistant-controller.ts:86-95` (`listNotes` →
`MentionFile`) and `assistant-controller.ts:85` (`agentListSkills` →
`SkillSummary`).

CodePilot's input was studied as a reference. It uses a native `<textarea>` with
plain-text `@path` tokens and renders chips in a separate row above the textarea,
anchoring the popover to the input box (not the caret). It deliberately avoids
inline chips in a contenteditable host. FloatNote's requirements are stricter —
inline atomic chips, cursor-boundary protection, undo/redo that preserves chips,
a shared state between normal and large mode, and caret-following candidate
positioning — so the plain-text-token approach is insufficient. CM6 is the path
that satisfies every requirement without hand-rolling a custom rich-text engine.

## Decisions (confirmed)

- **Editor substrate:** CodeMirror 6 with atomic `WidgetType` chips and
  `atomicRanges`. Chips are decorations over the underlying text, not DOM nodes
  in an editable flow, so cursor-boundary, atomic delete, and history
  preservation are native CM6 behavior.
- **Large-input mode:** in-app overlay (fixed overlay within the same Tauri
  window), not a separate window. It keeps the same `EditorView` in place and
  switches only its host CSS class; this is simpler than host-swapping and
  keeps `EditorState`, DOM selection, history, and IME composition intact.
- **Structured send:** extend the `prompt` DTO with optional `references` and
  `skill` fields; update `src/platform/agent.ts`, Rust `agent_send`, and sidecar
  `runner.prompt()` to consume them. `userText` contains only visible prose; chips
  never appear as text.
- **Candidate popover:** caret-following, shared by `@` and `/`.

## Selected architecture

### Layering

```
src/assistant/input/
  model.ts        Reference document model (pure, no CM6 dependency)
  cm-extension.ts CM6 extension: ref atomic widgets + atomicRanges + theme
  ref-widget.ts   WidgetType subclass rendering .tag-chip
  trigger.ts      Pure: detectTrigger(text, pos) → {mode, query, from, to}|null
  filter.ts       Pure: filterItems(items, query) with substring + score sort
  popover.ts      Caret-following candidate list, unified for @ and /
  composer.ts     EditorState single source of truth; wiring + IME gate + send
  overlay.ts      Large-input overlay; swaps EditorView host, preserves state
  submit.ts       Pure: composePromptPayload(doc) → {userText, references, skill}
  *.test.ts       Pure-function unit tests
```

Existing pickers are downgraded to data sources and pure logic. `mention-picker.ts`
keeps `currentMentionQuery`/`MentionFile`/`MentionKind`; `skill-picker.ts` keeps
`currentSlashQuery`/`SkillSummary`. `assistant-controller.ts` data sources
(`listNotes`, `agentListSkills`) feed `popover.ts`. `assistant.ts` replaces its
`<textarea>` with a CM6 `EditorView` hosted inside `.assistant-input-wrap`.

### Document model

The logical source of truth is a `Doc` of segments, but CM6's `EditorState` is
the runtime source of truth for undo/redo and selection. The two are reconciled
by serializing the doc into a CM6 text representation plus atomic-range markers:

```ts
type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; ref: Ref };

interface Ref {
  kind: "file" | "skill";
  id: string;        // stable: file path or skill name; never the display label
  display: string;   // human label shown in chip
  meta?: { noteKind?: "inbox" | "tasks" | "piece" | "doc" };
}
```

CM6 text representation: visible prose as-is, each ref rendered as a short
stable placeholder token (e.g. a private-use unicode sentinel + ref index) so the
range is addressable. A state field maps ref ranges to `Ref` objects; the atomic
widget decoration renders the chip from that map. Because chips are decorations
over the placeholder ranges, CM6 `history` preserves them across undo/redo with
no custom stack.

### Chip rendering (atomic widget)

`ref-widget.ts` extends `WidgetType`:

- Renders a `contenteditable=false` `.tag-chip` span with `data-ref-id`,
  the `ref.display` label, a kind badge (reusing `.assistant-mention-kind`), and
  an X button that dispatches a transaction deleting the placeholder range.
- `eq()` compares by `ref.id` so unchanged chips are not rebuilt.
- `cm-extension.ts` provides `EditorView.atomicRanges.of` for every ref range so
  the caret cannot enter the chip interior and Backspace/Delete at an atomic
  boundary removes the whole range (native CM6 atomic semantics).
- Display name and internal id are separated: the widget shows `ref.display`;
  the placeholder range and state field carry the stable `ref.id`, so a renamed
  or duplicate display label never corrupts resolution.

### Candidate list (unified, caret-following)

`popover.ts` `createRefPopover()`:

- Positioned with `view.coordsAtPos(trigger.from)`; repositions on CM6 `update`
  (content change), `scrollChanged`, and `window resize`; clamps to viewport and
  flips above/below when it would overflow.
- One component for both modes; `trigger.ts` returns `mode`, and the popover
  loads the matching data source (`listFiles(scope)` for `file`,
  `agentListSkills()` for `skill`).
- Keyboard dispatched in CM6 keymap: ArrowUp/Down cycle (`cycleIndex` with modulo
  wrap), Enter/Tab confirm, Esc close. Confirmed item dispatches a transaction
  replacing the trigger range with a ref placeholder + trailing space.
- Mouse: hover syncs `selectedIndex` (keyboard focus follows pointer); click
  confirms; `mousedown` outside the popover closes it.
- `scrollIntoView({ block: "nearest" })` keeps the active item visible.
- Closing the popover leaves existing content untouched: it only stops
  trigger-tracking; already-inserted chips and a half-typed `@query` remain.
- No-match, query deletion, or caret moving out of the trigger range makes
  `detectTrigger` return `null` and the popover closes.

`trigger.ts` reuses the two CodePilot regexes: `@([^\s@]*)$` for file mode and
`(^|\s)\/([^\s]*)$` for skill mode (slash only at line start or after whitespace,
so `src/app` paths do not trigger).

`filter.ts` does case-insensitive substring match on label and description, then
a light score (prefix > word-boundary > substring, shorter label first) so
higher-relevance results surface first.

### Large-input mode (in-app overlay)

- Normal editor: CM6 `EditorView` in `.assistant-input-wrap`, auto-grows by line
  count up to `max-height: 120px`, then scrolls internally.
- The expand button opens a fixed in-app overlay by adding
  `.fn-input-large` to the existing `.assistant-input-wrap`; the same
  `EditorView` remains mounted and only remeasures. Cursor position, selection,
  text, references, undo/redo, and IME composition therefore remain in place
  without copying state or temporarily creating a second view.
- Same keymap (Enter sends, Shift+Enter newline), same popover, same chips.

### State synchronization and IME

- One `EditorState` is the single source of truth; there is no string copy between
  modes, so no content is lost on switch. Mode switch does not re-trigger
  autocomplete (popover is closed during the swap), send, or content parsing.
- IME: CM6 `compositionstart`/`compositionend` are native. The send keymap and
  popover-confirm keymap guard on `view.compositionState` / `e.isComposing` so
  Enter during composition does not submit, confirm a candidate, or trigger a
  shortcut send. Backspace/Delete are unaffected.
- Copy/paste/undo/redo: CM6 `history` covers undo/redo (chips preserved as
  decorations). `pasteInput`/`copy`/`cut` handlers serialize the affected
  segments to a custom MIME (`text/x-floatnote-refs`) carrying structured refs
  with a plain-text fallback; paste parses the MIME back into segments, falling
  back to plain text for external content.

### Structured send and protocol extension

`submit.ts` `composePromptPayload(doc)`:

```ts
interface PromptPayload {
  userText: string;                 // visible prose only; chips excluded
  references?: Ref[];               // all file/skill refs
  skill?: { name: string };         // first skill chip, if any
}
```

Protocol changes (backward compatible — fields optional):

- `src/platform/agent.ts` `agentSend` accepts `references`/`skill` and forwards
  them to the `agent_send` Tauri command.
- `src-tauri/src/commands.rs`/`agent/` `agent_send` accepts the new fields and
  writes them into the sidecar `prompt` message.
- `sidecar/src/protocol.ts` `prompt` type gains `references?`/`skill?`.
- `sidecar/src/runner.ts` `prompt()` serializes `references`/`skill` into the
  prompt it sends to Pi, preserving current `/skill:name` expansion semantics
  for skills and resolving file refs against the working directory (the sidecar
  already has filesystem access).

`assistant.ts` `submit()` calls `composePromptPayload(doc)` and passes the
payload to `deps.send`; `assistant-controller.ts` wires `agentSend` with the new
fields.

## Testing

Pure-function unit tests (jsdom where DOM is needed, with
`// @vitest-environment jsdom`):

- `trigger.test.ts`: `@`/`/` boundaries, mid-word non-trigger, close on
  deletion / caret-out.
- `filter.test.ts`: substring + score ordering, empty results.
- `model.test.ts`: insert/remove/serialize/parse round-trip, copy/paste MIME
  round-trip, display/id separation.
- `submit.test.ts`: doc → payload, chips excluded from `userText`, references
  and skill extracted correctly.
- CM6 integration (`*.test.ts` under jsdom): atomic cursor boundary, Backspace
  whole-chip delete, undo/redo preserves chips, overlay host-swap preserves
  selection and history.

Backend: `cargo test --lib` and `cargo check` / `cargo check --release` from
`src-tauri/`; exercise the full send flow with `npm run tauri dev`. Frontend:
`npm test`.

## Phased implementation

1. Doc model + CM6 chip basecoat (model, cm-extension, ref-widget, model tests).
2. Unified candidate popover (trigger, filter, popover, tests).
3. Large-input overlay (overlay, state-swap, tests).
4. Protocol extension and sidecar wiring (submit, agent.ts, Rust, sidecar,
   tests).
5. `assistant.ts` integration and end-to-end verification.

## Scope

This spec is large but cohesive: every part centers on the assistant input
composer and shares the CM6 substrate. The phased plan above keeps each phase
independently verifiable. No out-of-scope refactoring of the note editor or
render pipeline is included.
