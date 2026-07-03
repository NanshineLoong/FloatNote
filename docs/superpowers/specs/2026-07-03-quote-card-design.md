# Quote Card (引用卡片) — Design Spec

- **Date:** 2026-07-03
- **Status:** Approved (design), pending implementation plan
- **Scope:** MVP, macOS only for source attribution; card rendering cross-platform
- **Out of scope:** favicon fetching, Arc browser AppleScript, Windows source attribution (Windows stays text-only cards), changing the existing ⌥⌘C / ⌥⌘P trigger model

## 1. Goal

Upgrade the captured-quote block from a plain italic blockquote (`> [!quote]\n> text`, no source) into a **soft rounded card** with a **source header**: a row of clickable source chips (webpage title→URL, or app name) and a body of the captured text. Multiple consecutive captures **merge into one card** — body appends, source chips accumulate (deduped) — instead of producing separate blocks.

Visual target (chosen in brainstorming): a *minimal* card that does not read as a heavy "card component" — just a very light gray background with an 8px radius and a soft 3px left accent line, body 15px system sans with a 10px left indent. No favicon glyphs, no shadows, no tinted header band.

Non-goals for the MVP:
- favicon / site-icon fetching (chips are text + link only).
- Arc browser URL capture (Arc's AppleScript is non-trivial; falls back to app name).
- Windows source attribution (Windows capture path stays text-only; the card renderer still works on Windows for files that already contain chips).
- Per-source sub-grouping inside a card; a card is one flat body with one chip row.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Source capture scope | Best-effort: frontmost app name for all apps (NSWorkspace); URL+title for Chromium family (Chrome/Brave/Edge/Vivaldi) and Safari via `osascript`; Firefox/Arc/other browsers and non-browser apps fall back to app-name-only |
| Merge trigger | Structural / adjacency-based: merge into the `[!quote]` card block the caret is inside, or the one immediately preceding the caret separated only by blank lines; otherwise insert a new card at the caret |
| Merge source matching | Unconditional — any consecutive capture merges into the adjacent card regardless of source identity; source identity only gates chip dedup, not whether to merge |
| Card frame | Light gray bg `#f5f5f4`, 8px radius, 3px left accent `#c7c7c5`, no border elsewhere, no shadow (Variant B) |
| Body typography | 15px system sans, color `#202124`, left indent 10px (option ③ — slight indent, no font/size change) |
| Source chip row | 12px, muted `#6b7280`; web chip = `[title](url)` rendered as clickable `#2563eb` link, URL truncated with ellipsis at ~170px; app chip = plain app-name text; chips separated by ` · ` |
| Storage format | Approach 1 — source chips live in the callout title line as markdown links / plain text after `> [!quote] ` |
| Formatting location | Moves from Rust `quote.rs` to a new frontend module `src/note/quote.ts` (pure functions, Vitest) so the merge path can read/rewrite editor block state |

## 3. Architecture

### 3.1 New components

- **`src-tauri/src/source.rs`** (new module) — `capture_source() -> Option<Source>`. At the moment the capture shortcut fires, the source app is still frontmost (the note window is not shown/focused until the end of `run_capture`). This module:
  1. Reads `NSWorkspace.shared.frontmostApplication` (`localizedName`, `bundleIdentifier`) via `objc2`/`cocoa` (consistent with the existing `core-graphics` macOS layer in `capture.rs`). Always yields the app name.
  2. If `bundleIdentifier` matches a known browser family (Chromium family or Safari), runs a per-family `osascript` to fetch the active tab's URL and title. Scripts:
     - Chromium family (`com.google.chrome`, `com.brave.browser`, `com.microsoft.edgemacos`, `com.vivaldi.vivaldi`): `tell application "<Name>" to {URL, name} of active tab of front window`.
     - Safari (`com.apple.safari`): `tell application "Safari" to {URL, name} of front document`.
  3. Returns `Source { kind: Web, title, url }` if the script succeeds; otherwise `Source { kind: App, title: app_name, url: None }`.
  4. Any error (script fails, Automation permission denied, unknown bundle) → fall back to `Source { kind: App, title: app_name }`. Never returns `None` when the frontmost app can be identified; `None` only if even `NSWorkspace` fails.
- **`Source` type** — `#[derive(Serialize, Clone)] pub struct Source { kind: SourceKind, title: String, url: Option<String> }` with `enum SourceKind { Web, App }`. Chip dedup is custom frontend logic (Web by url, App by title — see §4.2), not structural equality, so `PartialEq` is intentionally not derived.
- **`src/note/quote.ts`** (new frontend module) — pure helpers:
  - `quoteBody(text: string): string` — line-by-line `> ` prefix (mirrors the old `quote::format_quote`), blank line → `>`.
  - `buildQuoteBlock(text: string, source: Source | null): string` — produces `> [!quote] <chips>\n<quoted body>`. When `source` is null (attribution totally failed) the title line is empty: `> [!quote]`.
  - `sourceToChip(source: Source): string` — `[title](url)` for Web (URL percent-encoding-safe), bare `title` for App.
  - `parseChips(titleLine: string): Source[]` — inverse: splits ` · `, recognises `[text](url)` vs plain text.
  - `mergeQuoteBlock(existingBlock: string, text: string, source: Source | null): string` — parses the existing block's title line, adds the new source chip if not already present (Web dedup by url, App dedup by title), appends `\n>\n` + `quoteBody(text)` to the body. Preserves the rest of the block.
  - `isQuoteCardBlock(blockText: string): boolean` — true iff the block's first line matches `^>\s*\[!quote\]`.
- **`src/note/quote.test.ts`** (new) — Vitest unit tests for the above (build, merge, chip parse, dedup, blank source, multi-line body, app vs web).

### 3.2 Reused, unchanged where possible

- `capture.rs::run_capture` — steps 1–6 (guard, accessibility, clipboard backup/clear, `simulate_copy`, read, restore) unchanged. Between "trim" and the current `quote::format_clip` call, insert `let source = source::capture_source();` and emit the structured payload instead of the formatted string. The `show()/set_focus()` tail is unchanged.
- `append.ts::buildCaretInsert` — **reused for the new-card path only** (computes the surrounding blank-line padding for a freshly built block). The merge path does not use it (it rewrites an existing block in place via a CodeMirror transaction).
- `editor.ts::insertAtPos` — reused by both paths (new-card insert at caret; merge = replace the existing block range with the merged text).
- `blocks/ranges.ts::blockRanges` — reused to locate the merge target block and its char offsets. `BlockRange` already treats a run of `>` lines (including `>` blank separators) as one block, so a merged card stays a single draggable/deletable block. No change to the range logic.
- `commands.rs::write_note` and `notes.rs` — **not touched**. The editor remains the source of truth; autosave→`write_note` persists the new markdown verbatim.
- `capabilities/default.json` — **no new permissions**. `quote-captured` is an existing event the frontend already listens to; the payload shape changes but the capability is unchanged. `osascript` and `NSWorkspace` are backend calls, not Tauri-scoped capabilities. The macOS Automation permission prompt is a one-time OS-level consent, handled by the system.

### 3.3 Payload change

The `quote-captured` event payload changes from `String` to a struct:

```ts
type QuotePayload = {
  text: string;                  // trimmed clipboard text (the captured quote)
  source: Source | null;         // null only if even the app name could not be obtained
};
type Source = { kind: "web" | "app"; title: string; url: string | null };
```

Rust serializes the same shape via `serde`. The frontend `main.ts` listener is rewritten to consume it (see §4).

The selection-popup spec (`2026-07-03-selection-popup-design.md`) routes its submit through `quote::format_clip`. Since that spec is not yet implemented, the implementation plan should make `submit_popup_capture` emit the **same `{text, source}` payload** (calling `source::capture_source()` at popup-capture time, while the source app is still frontmost). This keeps both entry points consistent. (Update the popup spec's §4 step 5b accordingly when implementing it — out of scope for *this* spec, but noted here so the seam is unambiguous.)

### 3.4 Rust `quote.rs`

`format_quote` / `format_clip` become unused after the payload change. Two options for the implementation plan: delete the module, or leave it as a thin fallback. **Recommend deleting** `quote.rs` and removing it from `lib.rs` to avoid dead-code drift, since formatting now lives in `src/note/quote.ts`. (If the popup spec's pre-implementation references make deletion awkward, keep `format_quote` as a pure helper and have `submit_popup_capture` use the new payload path instead — but the clean choice is deletion.)

## 4. Data flow

```
1. User selects text in a foreground app (e.g. Chrome), presses ⌥⌘C.
   → global-shortcut callback → capture::run_capture(app)
2. run_capture (steps unchanged through clipboard restore):
   a. Re-entrancy guard; accessibility check; clipboard backup/clear.
   b. simulate_copy()                         ← source app still focused
   c. sleep 150ms; read clipboard = text; restore clipboard.
   d. trim; if empty → bail (unchanged).
   e. source::capture_source()                ← NEW: app name (+ URL/title for browsers)
   f. emit_to("main", "quote-captured", { text, source })
   g. show()/set_focus() the note window (unchanged).
3. main.ts quote-captured listener (rewritten):
   a. Compute caret position; resolve doc + blockRanges.
   b. Find merge target T = the [!quote] card block containing the caret, OR the
      [!quote] card block immediately preceding the caret with only blank lines
      between T.to and the caret.
   c. If T exists:
        merged = mergeQuoteBlock(blockText(T), payload.text, payload.source)
        dispatch txn: replace range(T.from..T.to) with merged;
        selection anchor → end of merged block.
   d. Else:
        block = buildQuoteBlock(payload.text, payload.source)
        insert = buildCaretInsert(before, after, block)
        insertAtCaret(editor, insert)   ← existing path
   e. editor.focus() → autosave → write_note (unchanged).
```

### 4.1 Merge rule (precise)

Given `blocks = blockRanges(doc)` and caret offset `c`:

- **Inside case:** if there is a block `T` with `T.from <= c <= T.to` and `isQuoteCardBlock(textOf(T))` → merge into `T`.
- **Adjacent case:** else if there is a block `T` with `T.to < c`, no other block between `T` and `c`, the text in `(T.to, c)` is all whitespace/blank lines, and `isQuoteCardBlock(textOf(T))` → merge into `T`.
- **New card:** otherwise, build a new card and insert at `c` via `buildCaretInsert` + `insertAtCaret`.

Merge always appends the new body to the **end** of the target block (not at the caret position within the block), matching "加在那个采集的应用块的后边". The caret-within-block case therefore moves the cursor to the end of the appended body.

### 4.2 Chip dedup

When merging, add the new source as a chip only if no existing chip is "the same source":
- Web vs Web: same `url` (case-insensitive, trailing slash normalised) → skip.
- App vs App: same `title` (exact) → skip.
- Web vs App: never dedup against each other (a card can carry both a web chip and an app chip).

So a card's chip row grows monotonically with distinct sources.

## 5. Markdown format

A single-source capture from Chrome:
```
> [!quote] [GitHub](https://github.com/anthropics/claude-code)
> The quick brown fox jumps over the lazy dog.
```

After a second capture from the same URL:
```
> [!quote] [GitHub](https://github.com/anthropics/claude-code)
> The quick brown fox jumps over the lazy dog.
>
> Second clip appended to the same card.
```

After a third capture from the Terminal app:
```
> [!quote] [GitHub](https://github.com/anthropics/claude-code) · 终端
> The quick brown fox jumps over the lazy dog.
>
> Second clip appended to the same card.
>
> Third clip from the terminal — app chip added, no URL.
```

Raw-file portability: in Obsidian or any markdown viewer this is a normal `> [!quote]` callout whose title line is "GitHub(link) · 终端"; the body is the blockquote. The chips degrade gracefully to readable title text.

## 6. Rendering (`preview.ts`)

Extend the existing callout handling (currently `preview.ts:253-266` hides the `[!type]` marker):

- **Header widget:** on the first line of a `[!quote]` card (non-cursor line), `Decoration.replace` the entire `> [!quote] <chips>` prefix with a `WidgetType` that renders the chip row. Each web chip is an `<a href="url" target="_blank">title</a>` styled as a chip; URL text is hidden (the link text is the title). Each app chip is a `<span>app name</span>`. Chips separated by a `·` glyph. Long titles: `text-overflow: ellipsis; max-width: 170px` on the link. On the cursor line, leave the raw `> [!quote] ...` text editable (same behaviour as today's marker hide).
- **Card frame:** for every line of a `[!quote]` card block, `Decoration.line({ class: "cm-quote-card-line" })` plus `cm-quote-card-first` / `cm-quote-card-last` on the first/last lines for rounded corners. CSS (light):
  - `.cm-quote-card-line { background: #f5f5f4; border-left: 3px solid #c7c7c5; padding-left: 10px; }`
  - `.cm-quote-card-first { border-top-left-radius: 8px; border-top-right-radius: 8px; }`
  - `.cm-quote-card-last { border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }`
  - body lines: font-size 15px, color #202124 (inherited from editor; no override needed beyond the indent).
- The existing `.cm-preview-blockquote` styling is left for *non-card* blockquotes (plain `> text`); `[!quote]` cards get the card classes instead. `QuoteMark` decoration (hiding the `> `) is reused unchanged for card lines so the user does not see raw `> `.

This is the implementation's most delicate area — multi-line card backgrounds in CodeMirror 6 via per-line decorations. The plan should sequence it carefully and verify against drag/reorder (the block-range changes mid-drag must recompute decorations).

## 7. Styling tokens

Light (mirrors existing `styles.css` conventions):
| Token | Value |
|---|---|
| Card bg | `#f5f5f4` |
| Left accent | `#c7c7c5` (3px) |
| Radius | `8px` |
| Body font | `-apple-system, "SF Pro Text", system-ui, sans-serif` 15px / 1.5 |
| Body color | `#202124` |
| Body indent | `padding-left: 10px` |
| Chip font | 12px `#6b7280` |
| Chip link | `#2563eb` (light) |
| Chip max-width (URL/title) | ~170px, ellipsis |

Dark (`@media (prefers-color-scheme: dark)`):
| Token | Value |
|---|---|
| Card bg | `#2a2a29` |
| Left accent | `#4a4a4a` |
| Body color | `#e6e6e6` |
| Chip text | `#9ca3af` |
| Chip link | `#60a5fa` |

Transitions: 120–180ms opacity on chip hover, matching existing hover cadence.

## 8. Error handling & edge cases

- **Automation permission denied / first-run prompt:** the first `osascript` against a browser triggers macOS's "FloatNote wants to control <Browser>" consent. If denied, `capture_source` catches the error and falls back to `Source { App, app_name }`. The card still inserts with an app-name chip. No crash, no banner needed (best-effort by design).
- **`osascript` slow / hangs:** wrap the script call with a timeout (e.g. 2s). On timeout, fall back to app-name-only. Browser AppleScript is normally <100ms but can stall; the guard prevents a frozen capture.
- **Firefox / Arc / unknown browser:** bundle id does not match the known families → app-name-only chip. Documented as expected, not a bug.
- **Frontmost app is FloatNote itself** (e.g. user triggers capture while the note window is focused): `capture_source` returns the FloatNote app name as an App chip. Acceptable (rare; user is capturing from their own note). Could special-case to `null`, but not necessary for MVP.
- **Empty selection / clipboard empty after copy:** unchanged — `run_capture` bails before emitting; no card inserted.
- **Caret in the middle of a non-quote block:** no adjacent quote card → new card inserted at caret via `buildCaretInsert` (respects surrounding blank-line padding). Two cards may end up adjacent; a *subsequent* capture then merges into the second (adjacent) card, not the first — correct per the adjacency rule.
- **Merge target is a `[!quote]` card but the title line is malformed** (user hand-edited it): `parseChips` is lenient — unrecognised title text is treated as a single App chip with that text. Merge still appends the body. No data loss.
- **Very long accumulated card:** no hard cap in MVP. The adjacency rule bounds growth naturally (any intervening non-quote block breaks the chain). If a card grows huge it remains one draggable block; acceptable for MVP.
- **Drag/reorder of a merged card:** `blockRanges` already treats the whole card as one block; `moveBlockChanges` swallows one adjacent `\n\n` separator. Unchanged — merged cards drag as a unit.
- **Raw `> [!quote]` with no title (legacy files / attribution failed):** renders as a card with an empty chip row (just the bg frame). Body still styled. Graceful.

## 9. Testing

Per CLAUDE.md (Vitest frontend, `cargo check` backend, manual `npm run tauri dev` for platform flows).

Frontend (`src/note/quote.test.ts`, new):
- `buildQuoteBlock`: single web source → correct title line + body; null source → empty title; multi-line body preserves blank lines as `>`.
- `parseChips`: round-trips `sourceToChip`; handles ` · ` separation, mixed web+app, trailing/leading spaces, malformed `[text](` fragments.
- `mergeQuoteBlock`: appends body after `>` blank separator; adds new chip; dedups web-by-url (trailing-slash/case), app-by-title; does not dedup web vs app; preserves existing body and chip order.
- `isQuoteCardBlock`: matches `> [!quote]` and `>  [!quote]` and `>[!quote]`; rejects plain `> text`.

Frontend listener / merge-target resolution: ideally a focused test on the caret→block resolution helper (extract it as a pure function `resolveMergeTarget(doc, caret): {kind:"merge", range} | {kind:"new"}` so it is unit-testable without a live CodeMirror). The plan should factor this out.

Rust:
- `cargo check` from `src-tauri/` must pass.
- `source.rs`: the bundle-id → browser-family mapping and any pure helpers are `#[cfg(test)]`-able. `NSWorkspace`, `osascript` are platform IO — no unit tests; verified manually.
- `quote.rs`: if deleted, remove its tests (none exist today). If kept, leave as-is.

Manual verification checklist (`npm run tauri dev`):
1. Chrome: select text → ⌥⌘C → card appears in inbox with a clickable GitHub/whatever chip; click chip opens the URL in the default browser.
2. Immediately capture again from the same Chrome tab → body appends to the *same* card, no new chip.
3. Capture from a different Chrome tab → body appends, second web chip added to the title row.
4. Capture from Terminal → body appends, `终端` app chip added.
5. Type a normal paragraph, then capture → a *new* card is created (adjacency broken); the previous card is untouched.
6. Safari: same as Chrome (URL chip).
7. Firefox: capture → card with `Firefox` app chip only (no URL) — expected fallback.
8. First browser capture: macOS Automation prompt appears; deny → card still inserts with app-name chip.
9. Dark mode: card bg `#2a2a29`, accent `#4a4a4a`, link `#60a5fa`.
10. Drag a merged multi-source card in the inbox → moves as one unit.
11. Open the saved `_inbox.md` in a text editor → raw `> [!quote] [title](url) · 终端` title line is human-readable.
12. `npm test` and `npm run build` (tsc) pass.

## 10. Cross-platform notes

- macOS-only source attribution this phase; Windows `capture.rs` is already a stub. The **renderer** and **markdown format** are cross-platform: a `_inbox.md` containing chip title lines renders as a card on Windows too, and merging works on Windows (the merge path is pure frontend). So a Windows user still gets cards; they just have app-name/empty chips until Windows source capture is added in a later phase.
- The `osascript` approach is macOS-specific; phase-2 Windows attribution would need a different mechanism (e.g. UIAutomation address-bar read), explicitly out of scope.

## 11. Files touched

New:
- `src-tauri/src/source.rs`
- `src/note/quote.ts`
- `src/note/quote.test.ts`

Modified:
- `src-tauri/src/lib.rs` — register `source` module.
- `src-tauri/src/capture.rs` — call `source::capture_source()`, emit structured `{text, source}` payload instead of formatted string.
- `src-tauri/src/commands.rs` — only if commands change (none required; payload is emitted, not invoked).
- `src/note/main.ts` — rewrite `quote-captured` listener to consume `{text, source}`, resolve merge target, dispatch merge-vs-new transaction.
- `src/note/preview.ts` — header widget + card line decorations for `[!quote]` blocks.
- `src/note/quote.ts` — add `resolveMergeTarget(doc: string, caret: number): { kind: "merge"; range: BlockRange } | { kind: "new" }` (pure, unit-testable) plus the merge/new build helpers listed in §3.1.
- `src/styles.css` — `.cm-quote-card-*` classes (light + dark).
- `src/note/append.ts` — **not modified**; `buildCaretInsert` is reused unchanged for the new-card path.

Deleted (recommended):
- `src-tauri/src/quote.rs` — formatting moves to `src/note/quote.ts`. (Confirm no other references before deletion; the unimplemented popup spec references it and should switch to the new payload path.)

## 12. Open questions

None for the MVP. (favicon fetching, Arc support, and Windows attribution are explicitly out of scope.)
