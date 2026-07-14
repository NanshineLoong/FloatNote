# Inline Annotations for the Capture Area — Design Spec

- **Date:** 2026-07-15
- **Status:** Approved design; implementation plan pending
- **Scope:** Replace Inbox block handles, drag/reorder, block deletion, and block-scoped tags with text-range annotations in `_inbox.md`
- **Platforms:** macOS and Windows

## 1. Goal

The capture area becomes a continuous Markdown editor without a top-level
"text block" domain model or a left gutter handle. A user selects natural text,
opens the context menu, and assigns one or more tags. Tagged text reads like a
highlight: a neutral background indicates that the text is annotated, and thin
lines in the tags' original colors communicate tag identity and overlap.

The top tag bar remains the entry to tag management and filtered viewing. A
filter is no longer implemented by collapsing non-matching Markdown blocks.
Instead, it renders a read-only list of distinct contextual segments, one per
matching source context, without concatenating unrelated text.

The design must also fix the current metadata leak: tag definitions are only
visually hidden inside CodeMirror today, so deleting backward from the first
visible line can damage the closing `>` or separator and expose the comment.
No FloatNote metadata may exist in the editable CodeMirror document after this
change.

## 2. Non-goals

- Migrating or preserving existing block-scoped tag definitions or assignments.
- Maintaining compatibility with the legacy
  `<!-- floatnote-tags: ... -->` / `<!-- floatnote:tag=... -->` format.
- Applying annotations to piece documents, standalone documents, `_tasks.md`,
  assistant messages, or code content.
- Replacing Markdown structural parsing in features unrelated to Inbox
  top-level blocks.
- Adding a database or a second metadata file.
- Making the filtered annotation projection editable.

## 3. Confirmed decisions

| Area | Decision |
|---|---|
| Handle and drag | Remove the Inbox gutter handle, reorder, cross-pane drag/copy, and handle menu completely. |
| Annotation granularity | Text ranges, not top-level blocks. One annotation may not cross an eligible Markdown context boundary. A selection spanning contexts is split into multiple annotations. |
| Multiple tags | Different tags may overlap arbitrarily. A single tag is canonicalized into non-overlapping ranges. |
| Visual overlap | Neutral highlight plus thin stacked lines in each tag's original color. Never mix colors. |
| Visible names | Tag names do not appear in annotated body text or on hover. They remain in the top bar and context menus; accessible descriptions may expose them to assistive technology. |
| Persistence | New v2 tag definitions plus paired annotation markers in `_inbox.md`. Each annotation has a stable ID, and marker pairing is by ID rather than nesting. |
| Editor representation | CodeMirror edits clean Markdown. Tag, annotation, and quote-source metadata live in a CodeMirror `StateField` and are encoded only into autosave snapshots. |
| Filter view | A separate read-only segmented projection. Single-click focuses a result; double-click returns to the full editor and selects the source. Keyboard Enter is equivalent to double-click. |
| Legacy data | Discard it. Do not retain a legacy block parser for migration. |
| Quote merge | Replace generic block range use with a quote-card-specific range parser and minimal append changes. |
| AI | Replace block anchoring with exact text plus optional prefix/suffix context. Frontend and sidecar share the codec and annotation transformations. |

## 4. Why the editor uses a clean projection

The current tag decoration replaces a well-formed line-one definitions comment
with an invisible decoration. The comment and its newline remain editable
CodeMirror text. Once a user deletion makes that comment malformed, the exact
recognizer no longer matches it and the metadata becomes visible.

Adding `EditorView.atomicRanges` does not provide the required protection:
CodeMirror deletion commands treat atomic ranges as indivisible and can delete
the entire range. A transaction filter could protect every marker, but selection
deletion, copying, undo, and overlapping hidden markers would require many
special cases distributed through editor commands.

The Inbox therefore has two representations:

```text
disk `_inbox.md` -- decodeInbox --> clean Markdown + InboxMetadata
clean Markdown + InboxMetadata -- encodeInbox --> disk `_inbox.md`
```

`decodeInbox` and `encodeInbox` are pure transformations, analogous to parsing
and serializing JSON. They are not a second save buffer. The existing
`scheduleSave()` queue remains the only pending disk-write buffer.

The disk Markdown remains the durable source of truth. CodeMirror is an
editable projection of that source, with metadata held in the same editor
state as the document while the file is open.

## 5. Disk format and codec

### 5.1 Canonical v2 syntax

Tag definitions use a new versioned first-line comment so legacy definitions
cannot be mistaken for current data:

```md
<!-- floatnote:tags:v2 concept="观点"|c=#3b82f6; verify="待验证"|c=#f5a623 -->
```

Each text annotation has one start and one end marker:

```md
<!-- floatnote:ann:v2 id=ann-a tag=concept start -->复杂问题拆成
<!-- floatnote:ann:v2 id=ann-b tag=verify start -->可验证
<!-- floatnote:ann:v2 id=ann-a end -->的小步骤
<!-- floatnote:ann:v2 id=ann-b end -->
```

This example contains crossing rather than nested marker order. The decoder
pairs markers by `id`, so partially overlapping annotations do not need valid
HTML nesting.

Annotation and tag IDs use a restricted ASCII identifier syntax. The encoder
emits a deterministic marker order when multiple starts or ends share a source
position: end events precede start events, then events follow tag-definition
order and annotation ID. The decoder does not depend on this ordering for
correct pairing.

The existing quote bundle-id marker remains a disk concern:

```md
<!-- floatnote:bid=com.example.app -->
```

The codec extracts it into quote-source metadata so it is also absent from
CodeMirror.

### 5.2 Decoded state

```ts
interface TextAnnotation {
  id: string;
  tagId: string;
  from: number;
  to: number;
}

interface QuoteSourceMetadata {
  cardFrom: number;
  bundleId: string;
}

interface InboxMetadata {
  tags: TagDef[];
  annotations: TextAnnotation[];
  quoteSources: QuoteSourceMetadata[];
}

interface DecodedInbox {
  markdown: string;
  metadata: InboxMetadata;
  warnings: InboxMetadataWarning[];
}
```

All positions address the clean `markdown` string, never the encoded disk
string. `decodeInbox` removes v2 metadata and quote-source markers while
building clean ranges. `encodeInbox` reinserts metadata from the current clean
positions.

Legacy block tag definitions and markers are removed and ignored during decode.
They create no tags or annotations. The next autosave writes only the v2 format.

Malformed or orphaned v2 metadata is omitted from decoded state, recorded as a
warning, and removed by the next successful encode. It never prevents the
Markdown body from loading.

## 6. Editor state, mapping, history, and autosave

An Inbox-specific CodeMirror `StateField<InboxMetadata>` owns tags,
annotations, and quote-source positions. It exposes effects for adding,
removing, renaming, and recoloring tags and for adding/removing normalized text
ranges.

Every document transaction maps metadata positions through its `ChangeDesc`:

- An edit before a range shifts the range.
- An insertion strictly inside a range expands it.
- Insertion exactly at either boundary remains outside the annotation, giving
  stable and predictable boundary typing.
- Partial deletion shrinks a range.
- Deleting all annotated text removes the empty annotation.
- Quote-source metadata is dropped when its corresponding quote card no longer
  exists.

Metadata effects participate in CodeMirror history with inverse effects. One
context-menu action is one undo event. Undo/redo restores both text ranges and
tag state.

After any document or metadata change, the Inbox update listener synchronously
builds one encoded snapshot from the current clean document and StateField, then
passes that string to the existing `scheduleSave(path, snapshot)`. Debouncing,
mtime conflict checks, close-time `flushAll()`, and failure handling remain in
the existing save queue. A metadata-only action must schedule a save even when
`docChanged` is false.

Crash behavior is unchanged from normal text editing: only changes still inside
the existing autosave debounce window can be lost.

## 7. Range normalization and eligible selections

For each tag independently, annotations are stored as canonical intervals:

- Overlapping or adjacent ranges of the same tag merge.
- Adding a tag fills the selected eligible ranges without creating duplicates.
- Removing a tag subtracts the selection and may shorten, remove, or split an
  existing interval.
- Different tags do not normalize against one another and may overlap in any
  order.

Selection segmentation uses the CodeMirror Markdown syntax tree. Eligible
contexts include visible prose paragraphs, headings, list/task item text, table
cell text, and quote body prose. A selection spanning multiple eligible
contexts produces one annotation interval per context in a single transaction.
Whitespace-only fragments are ignored.

The system must not insert annotations into fenced or inline code, link
destinations, image syntax, hidden metadata, or other syntax-only ranges. A
partly eligible selection applies the tag to eligible fragments and reports
that unsupported fragments were skipped. A wholly ineligible selection keeps
the native context menu or shows a small non-blocking explanation.

## 8. Context-menu interaction

With a non-empty eligible selection, right-click opens the FloatNote annotation
menu instead of the system menu:

- Existing tags are listed by color and name.
- A tag fully covering the selection is checked.
- A tag covering only part of the selection has a mixed state.
- Selecting an unchecked or mixed tag fills the selected eligible ranges.
- Selecting a checked tag removes that tag from the selected ranges.
- A new tag can be created and applied in the same transaction.

Without a selection, right-click on ordinary text keeps the platform context
menu. Right-click on annotated text shows the annotations covering that point
and allows an entire containing annotation to be removed. Overlapping tags are
listed independently.

The same behavior applies to macOS right-click/Control-click and Windows
right-click. Tag names are visible in this menu, not as persistent body labels.

## 9. Decorations and overlapping colors

Annotation decorations are built from clean StateField ranges:

- Every annotated character receives the same subtle neutral background.
- Each covering tag contributes a thin underline in its canonical palette
  color.
- Multiple tags render as stacked original-color lines ordered by tag-definition
  order.
- Colors are never blended into a synthetic color.
- Decorations do not change line height or insert visible tag chips.
- No tag name appears in body text or on hover.
- Accessible descriptions expose covering tag names to assistive technology.

Because the editor document contains no metadata markers, native selection and
copying produce only clean Markdown text.

## 10. Segmented tag projection

Clicking a top-bar tag switches the capture area from the full editor to a
separate read-only projection. It does not collapse ranges inside the live
CodeMirror document.

For every matching annotation, projection logic finds its containing eligible
Markdown context. Contexts include paragraph, heading, list/task item, table
cell, or quote-body prose. Results are ordered by source position. Multiple
matching annotations in the same context render as one result segment with all
matching subranges highlighted.

Each segment is a separate visual and semantic item, so unrelated contexts are
never concatenated. The active tag is already identified in the top bar; result
segments do not repeat its name.

Interaction is intentionally asymmetric:

- Single-click focuses/selects the result segment without leaving the filter.
- Double-click exits the projection, restores the full editor, scrolls to the
  source annotation, and selects it.
- Keyboard Enter on a focused segment performs the same navigation as
  double-click.
- Clicking the active tag again or clicking “全部” restores the full editor.

The projection remains read-only. External or AI updates rebuild it from the
latest decoded state.

## 11. Quote-card behavior without generic blocks

A focused `quoteCardRange` parser recognizes a title line matching
`> [!quote]` plus its consecutive `>` lines. It is used only for quote capture
and merge decisions.

The merge resolver checks whether the caret is inside a quote card or separated
from the previous quote card only by whitespace, then compares source identity.
Same-source capture emits a minimal insertion at the card body end instead of
replacing and reserializing the entire quote. Different-source capture inserts
a sibling quote card after the candidate.

Minimal changes allow CodeMirror range mapping to preserve annotations already
inside the quote. The old tag-marker preservation code in `mergeQuoteBlock` is
removed. Bundle IDs are decoded into `quoteSources` and re-encoded with the
card, so source icons and same-app matching continue to work without visible
metadata.

## 12. Sidecar and AI tools

`@floatnote/note-logic` owns the codec and pure annotation transformations so
the frontend and sidecar cannot diverge.

Sidecar behavior changes as follows:

- `read_note` returns clean Inbox Markdown rather than internal comments.
- Block-oriented `set_tag` is removed and replaced by `tag_text`.
- `tag_text` accepts `exact`, optional `prefix`/`suffix`, `tagId`, and an
  add/remove action. The context fields disambiguate repeated text.
- `list_tags`, `tag_create`, `tag_update`, and `tag_delete` operate on v2
  metadata. Deleting a tag also deletes all of its annotations.
- Inbox `edit_note` applies its unique replacement to clean Markdown, maps
  metadata through the exact change, then encodes the result.
- When an Inbox contains annotations, `write_note` rejects whole-document
  overwrite and directs the agent to use `edit_note`. This prevents silent
  annotation loss.
- Permission previews describe a text excerpt and annotation count rather than
  a block preview and marker count.

The Rust host continues reading and writing opaque Markdown strings with the
existing permission, conflict, version, event, and watcher paths. No database or
new Tauri command is required.

## 13. Legacy removal and file/module impact

The Inbox top-level block domain is removed, including:

- `src/note/blocks/drag.ts` and its tests.
- `src/note/blocks/handle-gutter.ts`.
- `shared/note-logic/src/blocks/ranges.ts` and its tests.
- `BlockRange`, `blockRanges`, `moveBlockChanges`, and `removeBlockChanges`
  exports.
- Block tag APIs such as `blockTagId`, `blockTagIds`, `setBlockTagChange`, and
  `addTagAndSetBlockChanges`.
- The block-handle tag picker and block deletion action.
- Gutter handle, drag indicator, block tint, and block-filter CSS.
- Inbox drag cancellation during external file refresh.
- Sidecar block-anchor matching.

New focused areas are expected under `shared/note-logic/src/annotations/` and
`src/note/annotations/`, plus an Inbox codec/state integration near the note
session.

Only the Inbox top-level block domain is removed. CodeMirror block decorations,
Markdown fenced code blocks, assistant message blocks, and task-panel drag
behavior are unrelated and remain.

## 14. Error handling

- Missing, duplicated, or malformed annotation markers do not block Markdown
  loading. Invalid annotations are omitted and reported once through a
  non-blocking notice.
- Annotation references to missing tag definitions are ignored and reported.
- The next valid autosave removes invalid metadata from the disk encoding.
- A selection with no eligible text does not create an empty annotation.
- Deleting the final character of an annotation removes the annotation.
- Deleting a tag while its projection is active clears the active filter and
  restores the full editor.
- A metadata-only autosave failure follows the same visible error and retry path
  as a body edit.
- Platform-native context menus remain available wherever FloatNote has no
  applicable annotation action.

## 15. Testing and acceptance

### 15.1 Pure tests

- v2 codec encode/decode round-trip for tags, crossing annotations, same-offset
  markers, and quote bundle IDs.
- Clean projection contains no FloatNote metadata.
- Legacy block tag definitions and markers are discarded.
- Malformed, orphaned, duplicated, and unknown-tag markers produce warnings and
  no invalid ranges.
- Same-tag union, adjacency merge, subtraction, split, and full removal.
- Different-tag partial and complete overlap.
- Range mapping for insertions/deletions before, inside, and at boundaries.
- Exact text plus prefix/suffix matching and ambiguity rejection.
- Selection segmentation across eligible Markdown contexts and exclusion of
  code, URLs, images, and syntax-only ranges.
- Projection grouping by context, source ordering, and same-context coalescing.
- Quote-card range detection, same-source minimal append, and different-source
  sibling insertion.

### 15.2 Editor and DOM tests

- First-visible-line Backspace/Delete cannot reveal or mutate metadata.
- Copying annotated text contains no FloatNote comments.
- Metadata-only effects schedule autosave.
- Annotation and tag operations undo/redo as one event.
- Neutral highlight and stable original-color underline ordering.
- Annotated body DOM contains no visible tag names.
- Right-click menu checked/mixed states and native-menu fallback.
- Filter result single-click stays, double-click returns and selects, and Enter
  matches double-click.

### 15.3 Sidecar tests

- `read_note` returns clean Inbox Markdown.
- `tag_text` adds/removes unique target ranges and rejects ambiguous matches.
- `edit_note` maps unaffected and overlapping annotation ranges.
- `write_note` rejects annotated Inbox overwrite.
- Tag deletion reports annotation count and removes every associated range.

### 15.4 Manual acceptance

Run the Tauri app and verify:

1. Repeated Backspace at the beginning of the visible Inbox never exposes tag
   definitions or other metadata.
2. Selecting natural text and right-clicking can create and apply a tag.
3. Two partially overlapping tags show a neutral highlight and separate
   original-color lines without visible names.
4. Auto-save, close, and reopen reproduce the same ranges.
5. Copy/paste contains no FloatNote comments.
6. Cross-context selection creates separate annotations and skips unsafe syntax.
7. Tag filtering renders distinct contextual segments.
8. Single-click remains in the projection; double-click and Enter return to the
   source.
9. Quote capture and same-source merging remain correct.
10. macOS right-click/Control-click and Windows right-click share behavior.

Verification commands:

```bash
npm test
npm run build
npm run check
npm run review:ui
```

## 16. Documentation updates

Implementation must make focused updates to:

- Root `AGENTS.md` / `CLAUDE.md` module summaries.
- `src/note/AGENTS.md`.
- `shared/note-logic/AGENTS.md`.
- `sidecar/AGENTS.md`.
- `docs/architecture/frontend.md`.
- `docs/architecture/sidecar.md`.
- `docs/architecture/data-flow.md` and runtime boundaries if the clean/raw
  representation boundary is documented there.
- `docs/development/design-system.md` for the removed block menu/gutter and new
  annotation/context-menu/projection surfaces.

Historical specs and plans remain historical and are not rewritten.

## 17. Success criteria

- No Inbox handle, gutter, drag/reorder, cross-pane drag/copy, or block delete
  behavior remains.
- No runtime dependency on the Inbox top-level block parser remains.
- Users can tag eligible selected text, including partially overlapping ranges.
- No FloatNote metadata can be revealed or edited through CodeMirror.
- Annotated text never displays persistent tag names and never blends tag
  colors.
- Filtered results remain separate contextual segments and navigate according
  to the confirmed single/double-click behavior.
- Quote capture, autosave, undo/redo, external refresh, and sidecar editing
  preserve valid v2 annotations.
- Legacy block tags are discarded without migration code.
