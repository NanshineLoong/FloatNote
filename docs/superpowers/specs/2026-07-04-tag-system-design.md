# Tag System for the Capture Area (采集区标签) — Design Spec

- **Date:** 2026-07-04
- **Status:** Approved (design), pending implementation plan
- **Scope:** MVP, frontend-only; tags live inside `_inbox.md` and apply to top-level blocks in the Inbox editor (`#text-col`)
- **Out of scope:** tags on piece docs (`piece.md` and siblings), tag palette customization beyond the curated swatches, cross-project tag sync, Windows/macOS behavioral divergence (feature is platform-agnostic)

## 1. Goal

Give the capture area (the Inbox editor, `_inbox.md`) a complete tag/label system for **organizing and viewing** captured blocks. Each top-level block can carry **one** tag; the tag is expressed as a colored **block background tint** (card-like). A secondary control bar inside the capture area lists existing tags as colored discs, supports creating/editing/deleting tags, and filters the editor to only the blocks of a chosen tag.

Non-goals for the MVP:
- Multiple tags per block (single tag only — one disc, one background color, unambiguous filtering).
- Tags on piece documents — tags are scoped to the Inbox (`_inbox.md`) for v1.
- A custom/free color picker — color is chosen from a curated palette of ~8–10 swatches.
- AI-rewrite preservation of tags — if an AI whole-doc rewrite drops the tag comments, tags are lost (acceptable, rare; listed as a known limitation).
- Backend changes — tags are pure frontend Markdown; no Rust/Tauri command additions.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Tags per block | **Single** — one tag per block; one disc, one background color, simplest filtering |
| Tag data storage | **Embedded in Markdown** — `_inbox.md` is self-contained; tag definitions + per-block markers are HTML comments in the file; identity travels with the block on reorder (no fragile index mapping) |
| Tag-view entry placement | A **secondary control bar inside `#text-col`** (not the global topbar, which is shared across inbox/piece/split). Always expanded. Left: "采集区" label (click → clear filter / show all). Middle: row of colored discs (existing tags). Right: hollow `+` disc to create a tag |
| Disc interactions (rename/recolor/delete) | **Right-click context menu** on a disc; also reachable via a hover `⋯` affordance (same handler) for platforms where right-click is awkward |
| Per-block tag indicator | **Block background tint only** — no disc in the gutter; the gutter keeps just the drag handle. Tag state is conveyed by a translucent background color + 3px left accent over the whole block (card-like) |
| Per-block assignment entry | The existing block-handle click menu (`ACTIONS` in `handle-gutter.ts`) gains a `标签…` entry (the code comment already foresees this); it opens a tag-picker popover anchored at the handle |
| Color source | **Curated palette** of 8–10 swatches; block background is a ~0.12-alpha tint derived from the swatch; left accent is the solid swatch color |
| Markdown syntax | **Approach A — hidden HTML comments.** Line 1 carries the definitions comment; each tagged block carries an inline trailing `<!-- floatnote:tag=<id> -->` marker. Markers are keyed by **slug id**, so rename/recolor only edits line 1 |
| Undo for delete | Deleting a tag is a **single CodeMirror transaction** that removes all per-block markers for that id and the defs entry on line 1; `⌘Z` restores everything in one step. A toast confirms and advertises `⌘Z` |

## 3. Architecture

### 3.1 New modules (`src/note/tags/`)

Each module has one responsibility and can be reasoned about / tested independently.

| Module | Responsibility | Depends on |
|---|---|---|
| `model.ts` | Pure logic: `TagDef{id,name,color}`, `TagMap` (id→def); parse/serialize the defs comment; parse/set/clear/replace a block's tag marker; slug generation with uniqueness guard; `stripTagMarker(line)` for chip parsing; read a block's tag id by **whole-block scan**. No DOM/CM. | `blocks/ranges.ts` |
| `palette.ts` | Curated 8–10 swatches (hex); `tint(hex)` → translucent bg (~0.12 alpha); `accent(hex)` → solid. Pure. | — |
| `decoration.ts` | CodeMirror `ViewPlugin`: (1) `Decoration.replace({})` to hide every `<!-- floatnote… -->` comment; (2) for each tagged block, a line decoration applying `cm-tagged-block` + `--tag-bg`/`--tag-accent` CSS vars. Re-parses `TagMap` + block→id mapping from the doc on every update. | `model.ts`, `palette.ts`, `blocks/ranges.ts` |
| `filter.ts` | `activeTagId` state + `ViewPlugin`: when active, collapse every block **without** that tag's marker via `Decoration.replace({ block: true, widget })` into a thin `⋯` placeholder. Pure computation of hidden ranges over `blockRanges` + `TagMap`, plus the decoration. | `model.ts`, `blocks/ranges.ts` |
| `bar.ts` | The secondary control bar DOM: "采集区" title button (click → clear filter), disc row (left-click → filter toggle; right-click/hover-⋯ → context menu), hollow `+` disc → add-tag popover. Mounts in `#text-col` above `#editor-root`, sticky. | `model.ts`, `palette.ts`, `toast.ts` |
| `picker.ts` | Per-block tag-picker popover (opened from the handle menu): lists existing tag discs + "无标签" (clear) + optional "+ 新建" (create-and-assign in one transaction). | `model.ts`, `palette.ts` |
| `toast.ts` | Small transient notice ("已删除标签「name」，⌘Z 撤销", ~4s auto-dismiss), anchored at the inbox bottom. | — |

### 3.2 Touched existing files (small, surgical changes)

- `src/note/blocks/handle-gutter.ts` — add to `ACTIONS`:
  ```ts
  { id: "tag", label: "标签…", icon: "ph-tag", run: (view, range, index) => openTagPicker(view, range, index) }
  ```
  The module comment already calls this out as the extension point.
- `src/note/quote.ts` — `parseChips` and `QuoteCardWidget`'s title source call `stripTagMarker(line)` before chip parsing, so a single-line callout `> [!quote] chip<!-- floatnote:tag=x -->` parses chips correctly. `mergeQuoteBlock` strips the marker before rewriting the title/body and leaves the marker in place (whole-block scan finds it regardless of position after merge).
- `src/note/preview.ts` — `QuoteCardWidget.toDOM` strips the tag marker from the title line it receives.
- `src/note/main.ts` — mount the tag bar in `#text-col`; wire editor updates to `decoration`/`filter`; register the handle-menu `标签…` action to `picker`; register disc right-click/hover-⋯ to the context menu; show the delete toast.
- `src/styles.css` — `.tag-bar`, `.tag-disc`, `.tag-disc-add`, `.tag-picker`, `.tag-context-menu`, `.tag-add-popover`, `.cm-tagged-block` (background + left accent), `.toast` styles.

### 3.3 Untouched

- `src/note/blocks/ranges.ts` — markers are inside block ranges by construction; `blockRanges` needs no change. (A test is added to confirm a block with a trailing marker still parses as one block and `r.to` lands after the marker.)
- The Rust backend — no new Tauri commands, no `notes.rs` changes. `cargo check` is unaffected. Tags are read/written as ordinary Markdown text through the existing autosave path.

## 4. Markdown format & parsing

### 4.1 Definitions comment (line 1, hidden)

```
<!-- floatnote-tags: concept="概念"|c=#e5484d; todo="待办"|c=#f5a623 -->
```

- Format: `<!-- floatnote-tags: ` + entries joined by `; ` + ` -->`.
- Each entry: `<id>="<name>"|c=<hexcolor>`. `id` is a slug `[a-z0-9-]+` derived from `name` at creation time; collisions are resolved by appending `-2`, `-3`, …
- **Block markers store `id`, not `name`** — rename/recolor only edits line 1.
- Writing defs: if line 1 matches the pattern, replace it in place; otherwise insert a new line 1 + newline (shifting the doc down). The insert/replace is a normal CM transaction; `blockRanges` recomputes from the new doc.
- When the **last** tag is deleted, remove the defs comment line entirely (the file returns to having no line-1 marker) so the inbox stays clean.
- Parsing is lenient: a missing or malformed defs comment is treated as an empty `TagMap`; never throws.

### 4.2 Per-block marker (inline, inside the block, hidden)

```
普通段落最后一行<!-- floatnote:tag=concept -->

> [!quote] 来源
> 引用正文
> 末行<!-- floatnote:tag=todo -->

- [ ] 待办事项<!-- floatnote:tag=todo -->
```

- Format: `<!-- floatnote:tag=<id> -->`, appended at the end of the block's last line (i.e. inserted at offset `r.to`, just past the block's last character).
- **Set**: if the block already contains a `floatnote:tag=` marker, replace its id in place; otherwise append at `r.to`.
- **Clear**: regex-delete the marker span from the block text.
- **Read a block's tag**: scan the **entire block text** (`doc.slice(r.from, r.to)`) for `<!-- floatnote:tag=([a-z0-9-]+) -->`, not just the last line. This survives quote-merge, which moves the old last line into the middle of the block.
- `blockRanges` is unchanged: the marker lives inside the block range, so reordering, inserting, or deleting blocks carries the marker with the block — no offset/index bookkeeping.

### 4.3 Quote-merge preservation

`mergeQuoteBlock` appends the new body after a `>` blank separator (`>\n${quoteBody}`). The old last line (which carried the marker) is no longer last. Because tag reading is a whole-block scan, the marker is still found. The merge function strips the marker before rewriting the title/body and does not re-emit it elsewhere — the original marker line stays in the block. Minimal change.

### 4.4 Chips are not polluted

`parseChips` and `QuoteCardWidget` call `stripTagMarker(line)` on the title line before parsing, so a single-line callout's trailing marker does not become part of the chip string.

### 4.5 Rendering invisibility

`decoration.ts` applies `Decoration.replace({})` over every `<!-- floatnote… -->` match (defs comment and per-block markers), guaranteeing they are invisible in the live preview regardless of how CodeMirror's markdown mode would otherwise render HTML comments. The block tint is a separate line decoration applied by the same plugin.

## 5. Data flow

Single source of truth: the `_inbox.md` text. There is no separate tag-state store; `decoration.ts` and `bar.ts` re-derive `TagMap` + block→id mapping from the doc on every change.

### 5.1 Create a tag (bar `+` disc)

1. Click the hollow `+` disc → add-tag popover: curated swatches + name input + 确认.
2. On confirm: compute slug (uniqueness-guarded) → rewrite line 1 defs (insert if absent) → one CM transaction. The new colored disc appears in the bar.
3. Creating a tag does **not** assign it to any block; assignment is §5.2. (The picker's optional "+ 新建" creates-and-assigns in one transaction.)

### 5.2 Assign a tag to a block (handle menu `标签…`)

1. Click a block's left handle → menu → `标签…` → `picker` opens anchored at the handle.
2. Picker lists existing tag discs + "无标签" (clear) + optional "+ 新建".
3. Pick a tag (or 无标签) → one transaction: set/replace/clear the block's marker. `decoration` re-runs → the block gets the tint + left accent (card-like).

### 5.3 Filter (click a disc in the bar)

1. `activeTagId = id` → `filter.ts` collapses every block **without** that marker into a thin `⋯` placeholder via `Decoration.replace({ block: true, widget })`. Only matching blocks remain visible and editable.
2. Click the same disc again, or click "采集区" → `activeTagId = null` → all blocks restored.
3. The active disc gets `.active` (ring highlight).

### 5.4 Rename / recolor (right-click a disc, or hover `⋯`)

- **重命名**: the disc turns into an inline text input; Enter commits (empty names rejected) → edit only the `name` field for that id on line 1 → one transaction. Block markers are untouched (id unchanged). Esc cancels.
- **换颜色**: swatch submenu → edit only the `color` field for that id on line 1 → one transaction. Block tints re-derive.

### 5.5 Delete (right-click a disc → 删除)

1. **One CM transaction** does both: (a) remove every `<!-- floatnote:tag=<id> -->` marker in the doc; (b) remove that id's entry from the line-1 defs. If the deleted tag is the active filter, clear `activeTagId` in the same step.
2. Because everything is in one `view.dispatch`, `⌘Z` restores all markers, the defs entry, and (if it was active) the filter state in a single undo step.
3. Show a toast: 「已删除标签「name」，⌘Z 撤销」, auto-dismiss ~4s.

## 6. Rendering details

- **Block tint**: `cm-tagged-block` line class applied to every line in a tagged block's range, with `--tag-bg` (swatch at ~0.12 alpha) and `--tag-accent` (solid swatch) CSS vars. CSS: `background: var(--tag-bg); border-left: 3px solid var(--tag-accent);`. Multi-line blocks read as one card.
- **Tag bar**: sticky top strip inside `#text-col`, always expanded. Empty state (no tags yet) shows "采集区" + the `+` disc + a hint "点 + 新建标签".
- **Disc**: round, `background: var(--c)` (the swatch); `.active` adds a ring; title attribute = tag name. Hollow `+` disc is an outlined circle.
- **Add popover**: row of swatches + name input + 确认/取消; Enter confirms.
- **Context menu**: items 重命名 / 换颜色 ▸ (swatch submenu) / 删除.
- **Picker**: popover listing tag discs (click to assign) + "无标签" + optional "+ 新建".
- **Toast**: small, anchored at the inbox bottom, ~4s auto-dismiss.
- **Split/narrow window**: the disc row scrolls/wraps horizontally; the tint decoration is attached only to the inbox editor (the piece editor is unaffected).
- **Platform**: right-click works on macOS (Ctrl-click / two-finger) and Windows; a hover `⋯` affordance opens the same context-menu handler as a fallback so the feature does not depend solely on right-click.

## 7. Error handling & edge cases

- **Orphan marker** (block has `tag=x` but `x` is absent from defs, e.g. line 1 was manually deleted): parse leniently; the block gets no tint and does not appear as a disc in the bar; `console.warn`. No crash, no auto-cleanup in v1.
- **Slug collision**: creation appends `-2`/`-3`; if a collision arises from manual edits, the next write re-normalizes.
- **Empty name / empty color**: rejected by frontend validation.
- **Merge**: `mergeQuoteBlock` strips the marker before rewriting and leaves it in place; whole-block scan still finds it (test added).
- **Delete the active filter tag**: the delete transaction clears `activeTagId` in the same step to avoid a dangling filter.
- **Editing while filtered**: collapsed blocks are not editable; click "采集区" to clear the filter and edit. Acceptable for v1.
- **AI whole-doc rewrite (`applyingRemote`)**: if the AI output preserves the comments, tags survive; otherwise they are lost. Not special-cased in v1 (rare). Known limitation.
- **Split / narrow window**: disc row scrolls/wraps; tint decoration is inbox-only.
- **Cross-platform**: right-click + hover `⋯` dual entry, same handler.

## 8. Testing (Vitest, pure logic prioritized)

- `tags/model.test.ts` — defs comment parse/serialize round-trip; block marker set/clear/replace; slug generation + uniqueness; orphan marker handling; `stripTagMarker` effect on chip parsing.
- `tags/palette.test.ts` — `tint`/`accent` derivation correctness (alpha present, hex preserved); contrast sanity (dark text remains readable on the tint).
- `tags/filter.test.ts` — given a doc + `activeTagId`, the computed hidden block ranges (pure function over `blockRanges` + `TagMap`) match the `Decoration.replace` spans the plugin emits.
- `quote.test.ts` (extend) — `parseChips` with a trailing tag marker on the title line; `mergeQuoteBlock` preserves a marker findable by whole-block scan after merge.
- `blocks/ranges.test.ts` (extend) — a block with a trailing `<!-- floatnote:tag=x -->` still parses as one block and `r.to` lands after the marker.
- DOM classes (`bar`/`picker`/`decoration`): focused snapshot tests on the pure builders; interaction flows exercised manually via `npm run tauri dev` on macOS.
- Pre-submit gates: `npm test` and `npm run build` (tsc) must pass. Backend: `cargo check` from `src-tauri/` (unchanged, but run to confirm no regression).

## 9. Open questions / known limitations

- **Tags are Inbox-only** for v1. Piece docs do not get tags. Extending to pieces later would reuse the same modules but mount the bar/decoration in `#piece-col`.
- **No custom colors** beyond the curated palette. A "自定义…" entry can be added later behind the same popover.
- **AI rewrites can drop tags.** Acceptable for v1; a future `applyingRemote` path could re-inject defs/markers, but that is out of scope.
- **Filtering hides blocks via `Decoration.replace`**, making them non-editable while a filter is active. This is intentional (filter = viewing mode); edit after clearing.
