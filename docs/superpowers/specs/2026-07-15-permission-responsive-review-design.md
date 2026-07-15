# Responsive Permission Review and Tag Text Disclosure Design

## Status

Approved design. Implementation plan pending.

## Goal

Improve two write-permission review flows in small FloatNote windows:

1. `edit_note` and `write_note` review must remain readable without horizontal
   scrolling when the review paper is too narrow for two useful diff columns.
2. `tag_text` permission cards must lead with the tag action and tag name while
   still allowing the user to inspect the complete target text without letting
   a long selection consume the whole note window.

This design amends the narrow-width and tag-operation decisions in
`2026-07-15-permission-review-card-dialog-design.md`. All other decisions in
that specification remain in force.

## Current State

The permission dialog already exposes two tabs for document edits:
`变更` and `新版本预览`. `变更` always renders a side-by-side line diff with a
`640px` minimum grid width. When the review paper is narrower, the diff body
therefore requires horizontal scrolling. This is especially awkward because
the review paper follows the main FloatNote window and may itself be small.

`新版本预览` is a rendered Markdown reading view. It is not a replacement for
the diff: switching between whole old and new documents would require the user
to remember changes. It should instead remain the second review mode beside a
responsive diff.

For `tag_text`, the frontend currently projects a single title such as
`为「文本摘要」添加标签「重点」`. The title is restricted to one line, so the
target excerpt can crowd out the most important information: the action and
tag name. The sidecar also sends only `exact.slice(0, 80)` as `textExcerpt`, so
the frontend cannot display the complete target text on request.

## Confirmed Product Decisions

1. Document-edit review uses a two-option view switch labelled `对比` and
   `新版本`.
2. `对比` is responsive to the available review-panel width:
   - when both columns can remain useful, it uses the existing aligned
     side-by-side diff;
   - when they cannot, it uses a unified single-column line diff.
3. The unified diff is the narrow layout. It does not introduce horizontal
   scrolling for normal prose. Inherently unbreakable content such as a long
   URL or code token may scroll or wrap within its own content surface, but it
   must not force the whole review panel sideways.
4. `新版本` continues to render the complete proposed Markdown. It is a final
   reading preview, not an original/new memory-based comparison switch.
5. A `tag_text` card separates the operation from its target:
   - title: `添加标签「重点」` or `移除标签「重点」`, with the tag color cue;
   - target row: a one-line, ellipsized excerpt prefixed by `目标：`.
6. Activating `展开` replaces the excerpt with the complete target text inside
   the card. The disclosure is capped at six text lines plus its vertical
   padding, calculated from the surface's actual line height; overflow scrolls
   vertically inside that text surface.
7. The `拒绝` and `允许写入` controls remain outside the scrolling target-text
   surface and stay visible while the text is reviewed.
8. Expanding, collapsing, switching review views, and changing responsive diff
   layout never resolve the permission request.

## Document Edit Review

### View Switch

Rename the existing tab labels to the shorter pair `对比` and `新版本`. Keep
the existing accessible tab semantics, arrow-key navigation, selected state,
and one shared tab panel.

`对比` is selected initially because permission review should first answer
“what will change?”. `新版本` renders the final Markdown so the user can then
answer “does the result read correctly?”. The selected view remains local UI
state for the open request and has no effect on approval mode.

### Responsive Diff Modes

Choose the diff layout from the actual width available to the review panel,
not from the main display size or an assumed Tauri window size. Use the review
panel as an inline-size CSS query container: widths of `680px` and above use
the side-by-side layout; widths below `680px` use the unified layout. This
leaves at least `340px` per column before their internal padding and removes
the current fixed `640px` overflow threshold.

Wide mode retains the existing side-by-side structure:

- `原版本` and `新版本` sticky column headings;
- aligned logical rows;
- removed content on the left and added content on the right;
- paired replacement rows;
- shared vertical scrolling and unchanged-context folding.

Narrow mode renders the same diff row model in one column:

- unchanged line: neutral row with a blank marker;
- removed line: `−` marker and removal styling;
- added line: `+` marker and addition styling;
- replacement: one removed row immediately followed by its added row;
- collapsed unchanged span: a full-width expandable row, identical in meaning
  to wide mode.

The renderer must preserve whitespace needed to understand Markdown while also
wrapping ordinary prose within the panel. Switching between wide and narrow
must not recompute permission data, reset expanded context spans, or move the
user to the `新版本` tab.

### Empty and Failure States

An empty proposed document continues to show `空文档` in `新版本`. An empty
side of a diff is represented by added or removed rows rather than a blank,
ambiguous panel.

If diff construction fails, the fallback must also be responsive. At a narrow
width it uses a unified escaped-text presentation instead of falling back to
the current two fixed `320px` columns.

## Tag Text Permission Card

### Compact State

The compact card gains a target-text row between the semantic title and the
footer:

```text
添加标签 ●「重点」
目标：“这是一段比较长的会议记录……”                 展开
                                      [拒绝] [允许写入]
```

The action and tag name are never part of the ellipsized target string. The
color dot remains adjacent to the tag name and keeps an accessible label so
color is not the only identifying cue. The complete target text is available
to assistive technology through the disclosure, not only through a pointer
tooltip.

The card always shows `展开`, even when the compact excerpt fits on one line, so
the interaction is stable and keyboard users have an explicit way to inspect
whitespace and line breaks. Empty target text is invalid for `tag_text` and
must be rejected before permission is requested.

### Expanded State

Activating `展开` replaces the one-line target row with a read-only text surface
containing the complete exact target:

```text
添加标签 ●「重点」
目标文本 · 全文
┌────────────────────────────────────────────┐
│ complete target text; scrolls after 6 lines │
└────────────────────────────────────────────┘
收起                                  [拒绝] [允许写入]
```

The surface preserves line breaks and ordinary whitespace, wraps prose, and
uses vertical scrolling after its height cap. It uses `overscroll-behavior` or
equivalent containment so reaching its edge does not unexpectedly scroll the
assistant dock. `收起` restores the compact excerpt without changing focus
unexpectedly.

The disclosure state belongs to the current request. Moving to the next queued
permission starts collapsed. Resolution disables the disclosure together with
the existing decision controls, preventing state changes during submission.

### Permission Data

Extend the structured `tag_assign` preview detail with a required `targetText`
field containing the complete exact target. Retain `textExcerpt` for existing
compact projections and compatibility. The permission UI must not attempt to
recover the target by searching `old_content`, because repeated text, Markdown
metadata, and normalization make that ambiguous.

Newly emitted `tag_assign` requests always provide both fields. When decoding a
legacy persisted request without `targetText`, the frontend falls back to
`textExcerpt`, labels the disclosure `可用文本`, and does not claim that it is
the full selection. The Rust protocol mirror, TypeScript protocol types,
frontend permission type, and protocol tests must change together.

## Component Responsibilities

Keep the existing permission boundaries and make focused extensions:

- `permission-dialog.ts` owns the `对比` / `新版本` switch and selects the diff
  renderer appropriate to the review-panel width.
- `permission-diff.ts` continues to produce one render-neutral row model. Wide
  and unified DOM renderers consume that same model; diff calculation is not
  duplicated.
- `permission-model.ts` projects tag action, tag name, color, compact excerpt,
  and complete target text as separate presentation fields rather than one
  concatenated title.
- `permission-bubble.ts` owns the collapsed/expanded state for the current tag
  request and resets it when the request changes.
- Sidecar and Rust protocol modules transport the complete target text without
  interpreting its presentation.

No new Tauri window, modal type, write mode, or backend permission state is
introduced.

## Accessibility and Interaction

- The view switch retains `tablist`, `tab`, and `tabpanel` semantics.
- Unified diff row labels communicate added, removed, modified, and unchanged
  state without relying on color.
- `展开` uses `aria-expanded` and references the full-text region.
- The full-text region is keyboard-scrollable when it overflows and receives a
  descriptive accessible label such as `标签“重点”的目标文本全文`.
- Focus remains on the disclosure control after expand/collapse unless the user
  explicitly moves it.
- Reduced-motion behavior remains unchanged; neither responsive switching nor
  disclosure requires animation.

## Testing

Add focused coverage for:

- wide review panels render the two-column diff;
- narrow review panels render unified rows and do not retain the `640px`
  minimum-width behavior;
- replacement, add-only, delete-only, whitespace, long-line, and folded-context
  cases have equivalent meaning in both layouts;
- `对比` and `新版本` switching preserves the correct content and accessible tab
  state;
- the diff failure fallback is single-column at narrow widths;
- `tag_text` titles always expose action, tag name, and color cue independently
  of excerpt length;
- compact target text is ellipsized and the disclosure exposes the full exact
  string, including line breaks beyond 80 characters;
- expanded text is height-capped with internal vertical overflow while decision
  controls stay outside the scrolling region;
- disclosure state resets for the next queued request and is disabled during
  permission resolution;
- sidecar serialization and Rust/TypeScript protocol decoding carry the new
  complete-target field.

Run the focused Vitest suites during development, then `npm test` and
`npm run build`. Because the protocol mirror changes in Rust, also run
`cargo test --lib`, `cargo check`, and `cargo check --release` from
`src-tauri/`. Exercise both a narrow and a wide permission dialog in
`npm run tauri dev`; the layout rule is cross-platform and must not depend on
macOS-only window behavior.

## Out of Scope

- character- or word-level diff highlighting;
- editing proposed content inside the permission dialog;
- a separate Tauri review window;
- original/new whole-document switching as a substitute for diff;
- redesigning `tag_create`, `tag_update`, or `tag_delete` cards;
- changing snapshot or permission-resolution semantics.
