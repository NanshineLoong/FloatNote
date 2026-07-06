# Per-Area Topbars — Implementation Plan

Goal: scope the 采集区 tag bar to the collection column only, and give the 写作区 its own fixed topbar (breadcrumb + version + trash + reserved mode-toggle slot), shown in single 写作 mode and in 双栏. The big editable title stays scrolling (Notion-style). Global `#topbar-root` is unchanged. Outline mode itself is out of scope — only a reserved slot.

Architecture choice (Approach A): both topbars are row-1 grid items in `#note-body`, placed via mode-dependent `grid-column` keyed off `#app`'s existing `show-piece` / `split-active` classes. No new JS view state.

## Tasks

### 1. Template: add `#piece-topbar-root` to `#note-body`
File: `src/note/main.ts` (the `app.innerHTML` template, ~line 64-77).
- Add `<div id="piece-topbar-root"></div>` as a sibling of `#tag-bar-root` inside `#note-body` (place it right after `#tag-bar-root`).
- Leave `#piece-doc-header` in `#piece-scroll` (it now holds only the title).

### 2. Split `createPieceHeader` into two mount points
File: `src/note/piece-switcher.ts`.
- Change signature to `createPieceHeader({ topbarMount, titleMount, host })`.
- Append `crumbRow` + a new empty `<div class="piece-mode-slot"></div>` to `topbarMount`.
- Append `title` (`.piece-title-input`) to `titleMount`.
- Keep `setLabel`, `fit`, menus, `commitRename` logic unchanged (closures still reach both elements).
- Update the JSDoc comment ("写作栏的文档头…" → note that crumb/version/trash now live in the fixed topbar, title stays scrolling).

### 3. Wire the two mounts in `mountPieceHeader`
File: `src/note/main.ts` `mountPieceHeader()` (~line 184).
- Query `#piece-topbar-root` and `#piece-doc-header`.
- Call `createPieceHeader({ topbarMount, titleMount, host: { ... } })` with the existing host object unchanged.

### 4. CSS: scope tag bar + add piece topbar + mode slot
File: `src/styles.css`.
- Add `#app.split-active #tag-bar-root { grid-column: 2; }` (overrides the `1 / -1` base; fixes the cross-column span bug).
- Add `#piece-topbar-root` base rule: `grid-row: 1; display: none; min-width: 0; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid rgba(0, 0, 0, 0.06);` (mirror `.tag-bar` band).
- Add `#app.show-piece:not(.split-active) #piece-topbar-root { display: flex; grid-column: 1 / -1; }` (single 写作: full width to margins).
- Add `#app.split-active #piece-topbar-root { display: flex; grid-column: 4; }` (双栏: scoped to writing column).
- Add `.piece-mode-slot { display: flex; align-items: center; gap: 4px; }` (empty reserved slot, right-aligned because `.piece-crumb-row` takes `flex: 1`).
- Change `.piece-crumb-row { width: 100%; }` → `flex: 1 1 auto; min-width: 0;` so it shares the topbar row with `.piece-mode-slot` (was `width:100%` because it was the only child of `#piece-doc-header`).
- Add dark-mode rule for `#piece-topbar-root` mirroring `.tag-bar` dark: `background: #1e1e1e; border-bottom-color: rgba(255, 255, 255, 0.08);` (inside the existing `@media (prefers-color-scheme: dark)` block near line 1739).

### 5. Tests: extend `split-css.test.ts`
File: `src/note/split-css.test.ts`.
- Add assertion: `#app.split-active #tag-bar-root { grid-column: 2; }` exists (collection bar scoped in split).
- Add assertion: `#piece-topbar-root` base `display: none; grid-row: 1;`.
- Add assertion: `#app.show-piece:not(.split-active) #piece-topbar-root` → `grid-column: 1 / -1`.
- Add assertion: `#app.split-active #piece-topbar-root` → `grid-column: 4`.
- Add assertion: `mainSource` contains `<div id="piece-topbar-root"></div>`.
- Add a new test file `src/note/piece-topbar.test.ts` (Vitest, DOM via jsdom) — `createPieceHeader` with two fake mounts: asserts crumb + version + trash + `.piece-mode-slot` land in `topbarMount`, title lands in `titleMount`, and `setLabel` updates both title value and breadcrumb label. (Check existing test setup for jsdom availability; if none, keep CSS-only tests and skip the DOM test.)

## Verification
- `npm test` — all Vitest tests pass (existing + new).
- `npm run build` — `tsc` type-check passes.
- `npm run tauri dev` — manual: single 采集 (tag bar full-width), single 写作 (writing topbar full-width with crumb/version/trash, title scrolls), 双栏 (tag bar col 2, writing topbar col 4, each non-scrolling, divided by the gap), document mode (topbar shows trash only), narrow-window split collapse (topbars reflow to full-width single).
- No Rust changes; `cargo check` not required.

## Files touched
- `src/note/main.ts`
- `src/note/piece-switcher.ts`
- `src/styles.css`
- `src/note/split-css.test.ts`
- (maybe) `src/note/piece-topbar.test.ts`
