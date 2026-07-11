# Markdown Editor Reliability Design

## Goal

Refactor FloatNote's CodeMirror 6 Markdown editor so cursor rendering, text
selection, indentation, live preview, media interaction, tags, lists, and the
outline view share explicit, non-overlapping state and document boundaries.
The implementation must preserve the existing Markdown file format and ship as
one complete, uniformly verified change.

## Context and root causes

The current live-preview builder handles inline syntax hiding, block rendering,
image replacement, list styling, and cursor-driven reveal logic in one
decoration pass. Tags are decorated by a separate plugin that computes block
ranges independently. Those layers can disagree about the ownership of a line
or source range. The resulting overlapping decorations explain the observed
image/adjacent-text coupling, tag bleed, widget teardown during clicks, and
unstable cursor geometry.

The current list commands operate on one physical line and only handle a
collapsed selection. They do not treat a list item and its descendants as one
structural unit. Visual indentation also mixes source whitespace with line
padding, allowing one list item to appear partially shifted relative to its
siblings.

Cursor and empty-line problems are primarily layout-contract failures. A
multiline placeholder participates in line layout, empty lines have no explicit
minimum line box, and cursor/selection styling is not defined as a coherent
theme contract. These issues should be corrected at the editor layout boundary,
not by drawing a replacement caret.

SilverBullet demonstrates the useful pattern of separating CodeMirror state
fields by responsibility and using syntax-node cursor containment to switch
between source and rendered states. FloatNote will adopt that pattern without
copying SilverBullet's mostly read-only media widget model; FloatNote images
require explicit selection, captions, alignment, and resizing.

## Selected architecture

Keep CodeMirror 6 and the Markdown document as the only persistent source of
truth. Split editor behavior into the following focused extensions:

- `editor-interaction` owns transient image selection/source state and the
  Enter, F2, and Escape transitions.
- `markdown-preview` owns headings, emphasis, links, quotes, tables, and fenced
  code source/render transitions.
- `media-preview` owns exact image source ranges, image widgets, captions,
  alignment, and resize interactions.
- `list-outline` owns list structure, indentation commands, fold state, and the
  simplified outline projection.
- `block-ranges` provides the single canonical block-range model consumed by
  tags, block handles, media, and related editor features.

Every decoration has one category: line style, inline hidden mark, range
replacement, or widget. Two extensions must never replace overlapping source
ranges. Line backgrounds may compose, but they cannot change syntax ownership.
Document text remains the only saved state; image selection, rendered/source
mode, and folding remain transient EditorState.

The alternative approaches were rejected for the following reasons:

- Continuing to patch the monolithic preview builder has lower initial cost but
  preserves the implicit shared ranges that caused the failures.
- Migrating to ProseMirror, Lexical, or another rich-text document model would
  simplify media node views but require rewriting Markdown persistence, tags,
  history, and sidecar integration. That migration is outside the justified
  scope of this reliability work.

## Cursor and selection

- Use CodeMirror's native caret and measurement. Do not create a custom caret
  DOM element or copy caret geometry.
- Headings may produce a taller caret because their actual text size is larger.
  Normal prose, blank lines, and placeholders must produce one normal line-high
  caret.
- Make placeholders single-line or place them in an overlay that does not
  participate in `.cm-line` height measurement.
- Give every `.cm-line`, including an empty line containing only a newline, a
  minimum height equal to normal prose line height.
- Define both CodeMirror selection backgrounds and native `::selection` using
  the same theme color. A drag selection crossing blank lines must show a full
  line-height selection region on those lines.
- Remove transitions, transforms, and pseudo-elements that can retain stale
  caret-like pixels. After geometry-changing document updates, request a normal
  CodeMirror measure pass rather than manipulating cursor DOM.

## Tab, indentation, and list structure

- Tab and Shift+Tab work for a single cursor and for multi-line selections.
- On normal text, indentation inserts or removes one configured indentation
  unit at each selected line start.
- On a list item, indentation moves the current item and its complete descendant
  subtree in one transaction.
- The first list item cannot be indented. A newly indented item cannot become
  more than one level deeper than its valid predecessor.
- Outdent moves the same complete subtree and preserves ordered-list structure.
- Mixed tabs/spaces in old documents are measured by visual leading columns.
  Invoking indent/outdent normalizes only the affected subtree; it does not
  rewrite the full document.
- Source indentation is the sole source of list horizontal position. Preview
  CSS may implement a marker hanging indent but must not add a second nesting
  offset.
- Fold anchors are document positions mapped through `ChangeDesc.mapPos`, not
  physical line numbers, so folding follows an item through indentation edits.

## Markdown input assistance

- Typing a third backtick on an empty or indentation-only line inserts a
  complete fenced code block with an internal blank line and places the cursor
  on that line.
- When text is selected, the command wraps the selection with fenced code
  markers and leaves the selection content inside the block.
- The opening line remains ready for a language identifier.
- Do not duplicate a closing fence when a valid close already exists, and do
  not trigger block completion for three backticks typed in ordinary inline
  content.
- Retain CodeMirror's existing bracket, square-bracket, quote, and inline-code
  pair completion. Do not add automatic quote, table, or other block templates
  in this change.

## Fenced code behavior

- When any selection head enters a `FencedCode` syntax node, reveal the entire
  raw fenced block, including opening/closing fences and language identifier.
- When the selection leaves that node, hide the fences, retain native editable
  CodeMirror text for the body, and apply nested-language syntax highlighting.
- Render mode may show a subtle read-only language label. Unsupported languages
  still render as plain monospaced code.
- Color tags add composable line backgrounds only. They do not wrap or alter
  the fenced-code syntax range.

## Image rendering and interaction

- Render a block image widget only when a line contains image syntax plus
  optional image attributes and an optional tag marker, with no other content.
  Inline images remain Markdown source in this change.
- An image source range ends at its own image syntax, attribute block, and image
  tag marker. It never consumes the preceding/following newline or an adjacent
  paragraph.
- Clicking a rendered image sets explicit `selectedImage` state and shows the
  toolbar without moving the prose cursor or tearing down the widget.
- Clicking adjacent text moves the prose cursor and clears image selection but
  leaves the image rendered.
- Enter or F2 while an image is selected moves the caret into that image's
  Markdown source. Escape returns it to rendered mode.
- Preserve the existing Markdown representation: the image alt/caption field
  stores the caption, while the attribute block stores width and alignment.
- The caption editor appears below the image and rewrites only the selected
  image's exact source range.
- Keep the eight resize handles and aspect ratio. Pointer movement updates only
  a DOM preview; pointer release creates one undoable document transaction.
- Toolbar, caption input, and resize handles belong to the widget interaction
  layer and must not participate in CodeMirror text-coordinate mapping.
- Unsafe or unparseable images stay as editable Markdown source.

## Canonical blocks and color tags

- Derive canonical blocks from Lezer block nodes plus explicit blank-line
  boundaries. Images, fenced code, tables, quotes, headings, list items, and
  ordinary paragraphs are distinct block types.
- A tag marker belongs only to the canonical block that contains the marker.
- Image tags cannot tint adjacent paragraphs. Quote, code, and table blocks may
  tint all their own lines without altering their internal Markdown parse.
- Generate non-overlapping block ranges before producing decorations. A tag's
  hidden marker and a media replacement must not cover the same source span.
- Tags, block handles, and media use this shared model rather than independent
  regular-expression range guesses.

## Lists and folding UI

- The normal editor uses the approved “Logseq ring” visual language. A
  collapsible parent uses a ring with a center dot as its fold control. A leaf
  item uses a lightweight hollow circle.
- Hover and keyboard focus enlarge the hit target without changing the visible
  marker size or shifting text.
- A folded item shows a compact descendant-count hint.
- Indent/outdent preserves the fold state of the corresponding parent by mapping
  its document anchor through the transaction.
- Ordered-list display is derived from the syntax tree and remains stable after
  indentation. Source numbering is not destructively rewritten merely for
  presentation.

## Simplified outline mode

- Outline mode displays only Markdown headings and ordered/unordered list items.
- Paragraphs, images, code blocks, tables, quotes, and other rich content are
  completely hidden in outline mode.
- H1-H6 headings form the main hierarchy. Lists attach to the nearest preceding
  heading. Lists before any heading attach to an implicit document root that is
  not written to Markdown.
- Clicking a heading or list item locates the corresponding source position in
  the normal editor.
- Outline editing changes only heading/list text and list hierarchy.
- Tab and Shift+Tab adjust list hierarchy only. Heading depth changes through an
  explicit heading command or shortcut, never implicitly through Tab.
- Fold state remains transient and is not written to the Markdown file.

## Compatibility and failure behavior

- Preserve existing Markdown image, caption, width, alignment, and color-tag
  syntax.
- Unsupported code languages fall back to plain monospaced code.
- Invalid media and ambiguous inline media remain visible as source so content
  is never trapped behind a broken widget.
- Use CodeMirror keymaps and standard Pointer Events on both macOS and Windows.
  Do not introduce platform-specific pointer/click assumptions.

## Testing and acceptance

Use test-driven development for every behavior change. Each root cause receives
a failing regression test before production code changes.

Automated coverage includes:

- Pure tests for canonical block/image ranges, list subtrees, indent/outdent,
  code-fence completion, and fold-anchor mapping.
- EditorState tests for fenced-code transitions, explicit image selection,
  non-overlapping tag/media decorations, and the heading/list-only outline.
- jsdom interaction tests for image selection, toolbar actions, caption editing,
  adjacent-text clicks, and a single resize commit on pointer release.
- CSS contract tests for empty-line height, consistent selection colors,
  normal one-line caret geometry, allowed heading caret growth, and stable list
  marker dimensions.
- Regression documents covering images above/below prose, consecutive images,
  tagged images, images in quotes, image-like code text, and tables combined
  with color tags.

Run the full frontend/shared and sidecar tests, production build, and sidecar
JSONL smoke test. Perform a final Tauri development-mode manual pass covering:

- delete text and move the caret backward without a ghost caret;
- drag-select across blank lines;
- normal and heading caret heights, including empty placeholders;
- Tab/Shift+Tab on prose, selections, and nested lists;
- fenced-code completion and source/render transitions;
- image selection, adjacent prose editing, caption/alignment, and eight-handle
  resizing;
- list indentation combined with folding; and
- the simplified heading/list-only outline.

Native WebView caret afterimages and OS selection painting are not reliably
assertable in jsdom. If the existing WebdriverIO/Tauri harness cannot assert
them deterministically, retain the explicit manual checks above rather than add
fragile pixel snapshots.

## Delivery

Implementation may proceed in independently testable internal stages, but the
user-facing handoff occurs only after all sections are implemented and the full
verification suite is complete. The final report must explain confirmed root
causes, the architecture adopted from SilverBullet, intentional differences,
trade-offs, test results, and any platform-specific manual checks that could not
be automated.
