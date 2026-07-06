# Quote Block Redesign — Implementation Plan

Scope: macOS-only. Extends the existing `[!quote]` chip-card model. No fundamental
rewrite. Approved design: persist `bundleId` per card, strict same-source merge,
live-rendered app icon, link-click via opener, automation-permission toast.

## Background facts (from codebase)

- `Source = { kind, title, url }` — `src/note/quote.ts:2`; mirrored in
  `src-tauri/src/source.rs:22`. Rust captures `bundleIdentifier()` at
  `source.rs:78` but discards it.
- Markdown: `> [!quote] <chips>` title line + `>`-prefixed body. Web chip =
  `[title](url)`; app chip = bare `title`. Builder `buildQuoteBlock` (`quote.ts:66`),
  merger `mergeQuoteBlock` (`quote.ts:77`), `resolveMergeTarget` (`quote.ts:118`).
- Renderer `QuoteCardWidget` (`src/note/preview.ts:110-142`); card-frame pass
  `preview.ts:339-386`; chip widget range uses `stripTagMarker(m[2])` at
  `preview.ts:378`.
- Tag marker convention: `<!-- floatnote:tag=<id> -->`, hidden by
  `src/note/tags/decoration.ts`; `stripTagMarker` in `tags/model.ts`.
- Backend registration: `src-tauri/src/lib.rs:107` `generate_handler!`.
  Custom `#[tauri::command]`s need no capability entry.
- Capture flows: `capture.rs:run_capture` and `popup.rs:run_popup_capture`,
  both call `source::capture_source()`.
- CSS: `src/styles.css:1393-1448`.

## Task 1 — Backend: bundleId in Source, app_icon command, open_url, automation event

Files: `src-tauri/src/source.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`,
`src-tauri/Cargo.toml`.

1. `source.rs`: add `pub bundle_id: Option<String>` to `Source` (serde camelCase →
   `bundleId`). In `capture_source`, set it on **both** the Web and App branches
   from the `bundle_id` local.
2. `source.rs`: change signature to `capture_source(app: &AppHandle) -> Option<Source>`
   (add `use tauri::{AppHandle, Emitter}`). When `browser_script(bundle_id).is_some()`
   but `browser_tab` returns `None`, emit `automation-needed` to `"main"` (only when
   the frontmost app *is* a known browser — avoids false positives for app sources).
3. `source.rs`: add `#[tauri::command] pub fn app_icon(bundle_id: String) -> Option<String>`
   (macOS). `NSWorkspace::urlForApplicationWithBundleIdentifier:` →
   `NSWorkspace::iconForFile:` → `tiffRepresentation` (NSData) → decode+resize via
   the `image` crate → PNG → base64 data-URI string. Non-macOS: `Option<String>`
   stub returning `None`. Verify the objc2-app-kit API via Context7 before writing.
4. `source.rs` tests: update `payload_serializes_camel_case` to include `bundleId`;
   add a `capture_source emits bundleId` shape test where feasible (pure logic only).
5. `commands.rs`: add `#[tauri::command] pub fn open_url(url: String) -> Result<(), String>`
   that runs `open <url>` on macOS (`std::process::Command::new("open").arg(url)`),
   `start` on Windows, `xdg-open` on Linux (guarded by `#[cfg]`).
6. `Cargo.toml`: add `image = "0.25"` under macOS deps; no opener plugin (custom
   command instead).
7. `lib.rs`: register `source::app_icon` and `commands::open_url` in
   `generate_handler!`.
8. Update call sites of `capture_source()`: `capture.rs:66` and `popup.rs:128` —
   pass `app`.

**Verify:** `cargo check` (macOS), `cargo test --manifest-path src-tauri/Cargo.toml`.

## Task 2 — Frontend quote.ts: Source + bid marker + strict merge

Files: `src/note/quote.ts`, `src/note/quote.test.ts`.

1. `Source` type: add `bundleId: string | null`.
2. Bid-marker helpers (mirror tag-marker style):
   - `buildBidMarker(bundleId) -> "<!-- floatnote:bid=... -->"`
   - `stripBidMarker(line) -> line` (removes the bid comment inline)
   - `readBidMarker(blockText) -> string | null` (whole-block scan, returns id)
3. `buildQuoteBlock`: append the bid marker **inline on the title line** after
   chips when `source?.bundleId`:
   `> [!quote] [Title](url)<!-- floatnote:bid=com.google.chrome -->`
4. `parseChips`: strip bid marker too (call `stripBidMarker` after `stripTagMarker`).
5. `mergeQuoteBlock(existingBlock, text)` — drop the `source` param (same-source is
   pre-checked by `resolveMergeTarget` now). Preserve the title line as-is (bid
   marker stays inline); append body after a `>` separator; re-append tag marker on
   the new last line (existing logic). No chip add/dedup.
6. `resolveMergeTarget(doc, caret, newSource) -> MergeTarget` where
   `MergeTarget = {kind:"merge", range} | {kind:"new", at: number}`.
   - Locate candidate card (inside / adjacent-preceding) as today.
   - Build `cardSource` = `parseChips(title)[0]` + `bundleId = readBidMarker(block)`.
   - `sameSource(card, newSource)`: bundleId equal (title-equal fallback when either
     bundleId is null); for web also `normalizeWebUrl(url)` equal.
   - Match + adjacent → `{kind:"merge", range}`.
   - Candidate exists but mismatch → `{kind:"new", at: cardRange.to}` (insert a new
     sibling block after the card, not splitting it).
   - No candidate → `{kind:"new", at: caret}`.
7. Rewrite `quote.test.ts` for: new `Source` shape (bundleId on helpers), bid marker
   in `buildQuoteBlock`, `mergeQuoteBlock` signature, `resolveMergeTarget` source
   param + newAfter. Keep round-trip and tag-marker coverage.

**Verify:** `npm test`.

## Task 3 — Renderer: icon, truncation, link click, strip bid

Files: `src/note/preview.ts`, `src/note/tags/decoration.ts`, `src/styles.css`.

1. `preview.ts`: module-level icon cache `Map<string, string|null>`, a `pending`
   set, a `pluginView` ref, and an `IconReadyEffect` `StateEffect`. `ensureIcon(view,
   bundleId)` returns cached data-URI or null and starts a fetch (`invoke("app_icon",
   {bundleId})`) on miss; on resolve, populate cache and dispatch `IconReadyEffect`
   via `queueMicrotask` so the plugin rebuilds.
2. Plugin `update(u)`: rebuild decorations also when `u.effects.some(e => e.is(IconReadyEffect))`.
3. `QuoteCardWidget`: constructor takes `(chipsStr, bundleId)`. `toDOM(view)`: render
   an optional `<img class="cm-quote-card-icon">` (src from `ensureIcon`), then the
   chip row. Link chip: `<a class="cm-quote-card-link">` with `title = title + " " + url`,
   no `target=_blank`; click handler `preventDefault` + `invoke("open_url", {url})`.
   App chip: `<span class="cm-quote-card-app" title=title>`.
4. `QuoteCardWidget.ignoreEvent(e)`: return `true` when `e.target` is inside
   `.cm-quote-card-link` (widget handles link clicks; editor won't place cursor or
   reveal raw markdown); else `false` (non-link clicks still reveal raw as today).
5. `preview.ts` chip-widget range: use `stripBidMarker(stripTagMarker(m[2]))` for the
   widget range so the bid comment stays outside the replaced range (hidden by
   decoration). Pass `readBidMarker(titleLine+block)` as the widget's `bundleId`.
6. `tags/decoration.ts`: ensure the comment-hide rule matches `floatnote:` generally
   (covers `bid=`), not only `tag=`. Extend the regex if needed.
7. `styles.css`: add `.cm-quote-card-icon` (14×14, margin-right 4px, flex-none);
   add ellipsis+max-width to `.cm-quote-card-app`; make `.cm-quote-card-chips`
   inline-flex with `min-width:0` so child truncation works.

**Verify:** `npm run build` (tsc), then manual `npm run tauri dev`.

## Task 4 — Permission/UX wiring + main.ts listener

Files: `src/note/main.ts`, `src/popup/main.ts`.

1. `main.ts` quote-captured listener: use `target.at` (not `caret`) for the new-block
   insertion path; merge path unchanged.
2. `main.ts`: `listen("automation-needed", () => showToast("未获得浏览器自动化权限，无法捕获网址/标题。请到 系统设置 › 隐私与安全 › 自动化 中允许 FloatNote 控制浏览器"))`.
3. `popup/main.ts`: add the same `automation-needed` listener (parity with the
   accessibility one) so the popup can show the toast too.

**Verify:** `npm run build`.

## Task 5 — Final verification

1. `npm test` (frontend unit tests).
2. `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo check`.
3. `npm run build` (tsc type-check + bundle).
4. Summarize manual GUI checks the user should run under `npm run tauri dev`:
   - Quote from Chrome (same URL twice adjacent) → merges, single card.
   - Quote from Chrome then Safari (different URL) → two sibling cards.
   - Card shows Chrome icon + clickable title (opens browser via `open_url`).
   - Long title truncates with ellipsis; hover shows full via `title`.
   - Clicking the link does NOT drop into raw `> [!quote]`; clicking elsewhere does.
   - Deny Automation → toast appears; URL/title absent until granted.

## Notes / risks

- objc2-app-kit icon API (NSWorkspace iconForFile, NSImage tiffRepresentation) —
  verify via Context7 in Task 1 step 3 before coding; fall back to the `image` crate
  TIFF route if the direct AppKit PNG path is awkward.
- Icon fetch is async; first paint shows no icon, rebuilds on fetch resolve.
- `automation-needed` is emitted to `"main"` (matches accessibility); popup shows
  it only if its listener is wired (Task 4 step 3).
