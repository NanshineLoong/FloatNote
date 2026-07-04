# Quote Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the captured-quote block from a plain blockquote into a soft rounded card with a source-header chip row, and merge consecutive captures into one card (body appends, chips accumulate/dedup).

**Architecture:** Source attribution moves to a new Rust module `source.rs` (macOS `NSWorkspace` via `objc2-app-kit` for the app name/bundle id, `osascript` for browser URL/title, best-effort with fallbacks). Formatting moves from Rust `quote.rs` to a new pure-TS module `src/note/quote.ts` (build/merge/parse chips, unit-tested). The `quote-captured` event payload changes from `String` to `{text, source}`. `main.ts` resolves a merge target (inside/adjacent `[!quote]` card) else inserts a new card. `preview.ts` renders the card frame (per-line decorations) plus a chip-row widget on the title line. `quote.rs` is deleted; `popup.rs` is updated to cache+emit the new payload.

**Tech Stack:** Rust (objc2 / objc2-foundation / objc2-app-kit, serde), Tauri 2, TypeScript, CodeMirror 6 (`@codemirror/view`/`state`/`language`), Vitest.

## Global Constraints

- macOS-only source attribution this phase; Windows `capture.rs` is a stub and `source::capture_source()` returns `None` on non-macOS. The renderer and markdown format are cross-platform.
- Card frame tokens (light): bg `#f5f5f4`, left accent `#c7c7c5` 3px, radius `8px`, body color `#202124`, body indent `padding-left: 10px`. Dark: bg `#2a2a29`, accent `#4a4a4a`, body color `#e6e6e6`, chip text `#9ca3af`, chip link `#60a5fa`.
- Chip row: 12px, muted `#6b7280` (light) / `#9ca3af` (dark); web chip is a clickable `#2563eb` (light) / `#60a5fa` (dark) link, URL/title `max-width: 170px` with `text-overflow: ellipsis`; app chip is plain text; chips separated by ` · `.
- Storage format: source chips live in the callout title line as markdown links / plain text after `> [!quote] ` (Approach 1).
- Merge is structural/adjacency-based, unconditional by source identity; source identity only gates chip dedup (web by url case-insensitive + trailing-slash-normalised, app by exact title; web vs app never dedup).
- Coding style: TS ES modules, two-space indent, double quotes, semicolons, camelCase. Rust `rustfmt`, snake_case, serde-serializable payloads.
- Run `npm test` before submitting TS behavior changes; `cargo check` from `src-tauri/` for backend changes.
- No new Tauri capabilities; `quote-captured` is an existing event (payload shape changes only).

---

## File Structure

**New:**
- `src-tauri/src/source.rs` — `capture_source()`, `Source`, `SourceKind`, `QuotePayload`, `frontmost_app()`, `browser_tab()`, `run_osascript()`.
- `src/note/quote.ts` — pure helpers: `Source` type, `quoteBody`, `buildQuoteBlock`, `sourceToChip`, `parseChips`, `mergeQuoteBlock`, `isQuoteCardBlock`, `resolveMergeTarget`, `MergeTarget`.
- `src/note/quote.test.ts` — Vitest unit tests for the above.

**Modified:**
- `src-tauri/Cargo.toml` — add `objc2`, `objc2-foundation`, `objc2-app-kit` (macOS target only).
- `src-tauri/src/lib.rs` — `mod source;` added, `mod quote;` removed.
- `src-tauri/src/capture.rs` — call `source::capture_source()`, emit `QuotePayload` instead of `String`.
- `src-tauri/src/popup.rs` — `PopupCache` stores `(text, source)`; `run_popup_capture` captures+cache source; `submit_popup_capture` emits `QuotePayload`.
- `src/note/main.ts` — rewrite `quote-captured` listener to consume `{text, source}`, resolve merge target, dispatch merge-vs-new transaction.
- `src/note/preview.ts` — card line decorations + `QuoteCardWidget`; skip `cm-preview-blockquote` and the plain callout-marker hide on `[!quote]` card lines.
- `src/styles.css` — `.cm-quote-card-*` classes (light + dark).

**Deleted:**
- `src-tauri/src/quote.rs` — formatting moves to `src/note/quote.ts`; no remaining references after `popup.rs` is updated.

**Unchanged (reused):**
- `src/note/append.ts::buildCaretInsert` — new-card path only.
- `src/note/editor.ts::insertAtCaret` / `insertAtPos` — both paths.
- `src/note/blocks/ranges.ts::blockRanges` — merge-target resolution; a run of `>` lines is already one block.
- `src-tauri/src/commands.rs`, `notes.rs`, `capabilities/default.json` — untouched.

---

## Task 1: TS source/chip pure helpers + tests

**Files:**
- Create: `src/note/quote.ts`
- Test: `src/note/quote.test.ts`

**Interfaces:**
- Produces: `Source` (`{ kind: "web" | "app"; title: string; url: string | null }`), `quoteBody(text): string`, `buildQuoteBlock(text, source): string`, `sourceToChip(source): string`, `parseChips(chipsStr): Source[]`, `mergeQuoteBlock(existingBlock, text, source): string`, `isQuoteCardBlock(blockText): boolean`. (Task 3 adds `resolveMergeTarget`.)

- [ ] **Step 1: Write the failing tests**

Create `src/note/quote.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  type Source,
  quoteBody,
  buildQuoteBlock,
  sourceToChip,
  parseChips,
  mergeQuoteBlock,
  isQuoteCardBlock,
} from "./quote";

const web = (title: string, url: string): Source => ({ kind: "web", title, url });
const app = (title: string): Source => ({ kind: "app", title, url: null });

describe("quoteBody", () => {
  it("prefixes each line with '> ' and turns blank lines into bare '>'", () => {
    expect(quoteBody("a\n\nb")).toBe("> a\n>\n> b");
  });
  it("single line", () => {
    expect(quoteBody("hello")).toBe("> hello");
  });
});

describe("buildQuoteBlock", () => {
  it("builds a title line with a web chip + body", () => {
    expect(buildQuoteBlock("hello", web("GitHub", "https://github.com/x")))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> hello");
  });
  it("empty title line when source is null", () => {
    expect(buildQuoteBlock("hello", null)).toBe("> [!quote]\n> hello");
  });
  it("app chip is bare text", () => {
    expect(buildQuoteBlock("hi", app("终端"))).toBe("> [!quote] 终端\n> hi");
  });
  it("multi-line body preserves blank lines", () => {
    expect(buildQuoteBlock("a\n\nb", null)).toBe("> [!quote]\n> a\n>\n> b");
  });
});

describe("sourceToChip / parseChips round-trip", () => {
  it("round-trips a single web chip", () => {
    const s = web("GitHub", "https://github.com/x");
    expect(parseChips(sourceToChip(s))).toEqual([s]);
  });
  it("round-trips a single app chip", () => {
    const s = app("终端");
    expect(parseChips(sourceToChip(s))).toEqual([s]);
  });
  it("parses mixed web+app separated by ' · '", () => {
    const str = "[GitHub](https://github.com/x) · 终端 · [HN](https://news.ycombinator.com)";
    expect(parseChips(str)).toEqual([
      web("GitHub", "https://github.com/x"),
      app("终端"),
      web("HN", "https://news.ycombinator.com"),
    ]);
  });
  it("trims surrounding whitespace per chip", () => {
    expect(parseChips("  终端  ")).toEqual([app("终端")]);
  });
  it("malformed '[text](' fragment becomes an app chip", () => {
    expect(parseChips("[broken(")).toEqual([app("[broken(")]);
  });
});

describe("mergeQuoteBlock", () => {
  it("appends body after a '>' blank separator", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", null))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> first\n>\n> second");
  });
  it("adds a new web chip", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", web("HN", "https://news.ycombinator.com")))
      .toBe("> [!quote] [GitHub](https://github.com/x) · [HN](https://news.ycombinator.com)\n> first\n>\n> second");
  });
  it("dedups web by url (case-insensitive, trailing slash)", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x/)\n> first";
    expect(mergeQuoteBlock(existing, "second", web("GitHub", "HTTPS://github.com/x")))
      .toBe("> [!quote] [GitHub](https://github.com/x/)\n> first\n>\n> second");
  });
  it("dedups app by exact title", () => {
    const existing = "> [!quote] 终端\n> first";
    expect(mergeQuoteBlock(existing, "second", app("终端")))
      .toBe("> [!quote] 终端\n> first\n>\n> second");
  });
  it("does not dedup web vs app", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", app("GitHub")))
      .toBe("> [!quote] [GitHub](https://github.com/x) · GitHub\n> first\n>\n> second");
  });
  it("preserves existing chip order", () => {
    const existing = "> [!quote] [A](https://a) · [B](https://b)\n> x";
    expect(mergeQuoteBlock(existing, "y", web("C", "https://c")))
      .toBe("> [!quote] [A](https://a) · [B](https://b) · [C](https://c)\n> x\n>\n> y");
  });
  it("merges into a card with empty body (title only)", () => {
    expect(mergeQuoteBlock("> [!quote]", "first", null)).toBe("> [!quote]\n> first");
  });
  it("adds chip when merging into a title-only card", () => {
    expect(mergeQuoteBlock("> [!quote]", "first", web("A", "https://a")))
      .toBe("> [!quote] [A](https://a)\n> first");
  });
  it("lenient on malformed title: unrecognised text becomes an app chip", () => {
    const existing = "> [!quote] some weird title\n> first";
    expect(mergeQuoteBlock(existing, "second", web("A", "https://a")))
      .toBe("> [!quote] some weird title · [A](https://a)\n> first\n>\n> second");
  });
});

describe("isQuoteCardBlock", () => {
  it("matches '> [!quote]'", () => {
    expect(isQuoteCardBlock("> [!quote]\n> x")).toBe(true);
  });
  it("matches extra spaces and '>[!quote]'", () => {
    expect(isQuoteCardBlock(">  [!quote] x")).toBe(true);
    expect(isQuoteCardBlock(">[!quote] x")).toBe(true);
  });
  it("rejects plain blockquote", () => {
    expect(isQuoteCardBlock("> text")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/note/quote.test.ts`
Expected: FAIL with errors like "Failed to resolve import" / "quoteBody is not defined" (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/note/quote.ts`:

```ts
/** Source attribution for a captured quote. `url` is null for app sources. */
export type Source = { kind: "web" | "app"; title: string; url: string | null };

/** Mirror of the old Rust `quote::format_quote`: line-by-line `> ` prefix,
 *  blank line -> bare `>`. Input is assumed trimmed (capture trims it). */
export function quoteBody(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** Escape `[`, `]`, `\` in chip text so it is safe inside a markdown link. */
function escapeChipText(text: string): string {
  return text.replace(/[\[\]\\]/g, (m) => `\\${m}`);
}

/** Inverse of escapeChipText. */
function unescapeChipText(text: string): string {
  return text.replace(/\\([\[\]\\])/g, "$1");
}

/** `[title](url)` for web (with url), bare `title` for app or web-without-url. */
export function sourceToChip(source: Source): string {
  if (source.kind === "web" && source.url) {
    return `[${escapeChipText(source.title)}](${source.url})`;
  }
  return escapeChipText(source.title);
}

/** Normalise a URL for dedup: lowercase, strip trailing slashes. */
function normalizeWebUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

/** True if `existing` already contains a chip matching `source` (dedup rules). */
function hasChip(existing: Source[], source: Source): boolean {
  if (source.kind === "web") {
    const u = normalizeWebUrl(source.url ?? "");
    return existing.some((c) => c.kind === "web" && normalizeWebUrl(c.url ?? "") === u);
  }
  return existing.some((c) => c.kind === "app" && c.title === source.title);
}

/** Parse the chip portion of a title line (text after `> [!quote] `).
 *  Splits on ` · `; `[text](url)` -> web, else app. Lenient on malformed input. */
export function parseChips(chipsStr: string): Source[] {
  const chips: Source[] = [];
  for (const part of chipsStr.split(" · ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = /^\[(.*)\]\((.*)\)$/.exec(trimmed);
    if (m) {
      chips.push({ kind: "web", title: unescapeChipText(m[1]), url: m[2] });
    } else {
      chips.push({ kind: "app", title: unescapeChipText(trimmed), url: null });
    }
  }
  return chips;
}

/** Build `> [!quote] <chips>\n<quoted body>`. Null source -> empty title line. */
export function buildQuoteBlock(text: string, source: Source | null): string {
  const chipsStr = source ? sourceToChip(source) : "";
  const titleLine = `> [!quote]${chipsStr ? ` ${chipsStr}` : ""}`;
  return `${titleLine}\n${quoteBody(text)}`;
}

/** Merge `text` (and optionally a new `source` chip) into an existing `[!quote]`
 *  card block. Appends body after a `>` blank separator; adds chip if not a dup.
 *  Preserves existing body and chip order. */
export function mergeQuoteBlock(
  existingBlock: string,
  text: string,
  source: Source | null,
): string {
  const lines = existingBlock.split("\n");
  const titleLine = lines[0] ?? "> [!quote]";
  const headerMatch = /^>\s*\[!quote\]\s?(.*)$/.exec(titleLine);
  let chips = parseChips(headerMatch ? headerMatch[1] : "");
  if (source && !hasChip(chips, source)) chips = [...chips, source];

  const chipsStr = chips.map(sourceToChip).join(" · ");
  const newTitleLine = `> [!quote]${chipsStr ? ` ${chipsStr}` : ""}`;

  const bodyLines = lines.slice(1);
  const newBody = bodyLines.length > 0
    ? `${bodyLines.join("\n")}\n>\n${quoteBody(text)}`
    : quoteBody(text);

  return `${newTitleLine}\n${newBody}`;
}

/** True iff the block's first line matches `^>\s*\[!quote\]`. */
export function isQuoteCardBlock(blockText: string): boolean {
  const firstLine = blockText.split("\n", 1)[0] ?? "";
  return /^>\s*\[!quote\]/.test(firstLine);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/note/quote.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/note/quote.ts src/note/quote.test.ts
git commit -m "feat(quote): add TS source/chip pure helpers with tests"
```

---

## Task 2: Rust `source.rs` module (macOS attribution)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/source.rs`
- Modify: `src-tauri/src/lib.rs:1-14` (module list)

**Interfaces:**
- Produces: `source::Source { kind: SourceKind, title: String, url: Option<String> }`, `source::SourceKind { Web, App }` (serde camelCase / lowercase), `source::QuotePayload { text: String, source: Option<Source> }`, `source::capture_source() -> Option<Source>`.

- [ ] **Step 1: Add macOS dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, extend the `[target.'cfg(target_os = "macos")'.dependencies]` section so it reads:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
macos-accessibility-client = "0.0.1"
core-graphics = "0.25"
objc2 = "0.2"
objc2-foundation = { version = "0.2", features = ["NSString"] }
objc2-app-kit = { version = "0.2", features = ["NSWorkspace", "NSRunningApplication"] }
```

> Note: the API below uses the safe (non-`unsafe`) `Retained<>` signatures confirmed from `docs.rs/objc2-app-kit/latest` (`NSWorkspace::sharedWorkspace() -> Retained<NSWorkspace>`, `frontmostApplication(&self) -> Option<Retained<NSRunningApplication>>`, `localizedName`/`bundleIdentifier -> Option<Retained<NSString>>`, `NSString` implements `Display`). If `cargo check` (Step 5) reports these as `unsafe`, bump all three crates to the next minor line (e.g. `"0.3"`) together — they must stay version-aligned.

- [ ] **Step 2: Create `src-tauri/src/source.rs`**

```rust
//! Best-effort source attribution at capture time. Always yields the frontmost
//! app name (via NSWorkspace — no permission needed); for known browsers also
//! fetches the active tab's URL+title via `osascript` (first use may trigger
//! macOS Automation consent; on denial/timeout/unknown bundle we fall back to
//! app-name-only). Never returns None when the frontmost app can be identified.

use std::process::Command;
use std::time::Duration;

/// Distinguishes a browser-tab source (has URL) from a plain app source.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Web,
    App,
}

/// One attributed source. Serializes to `{ kind, title, url }` (camelCase via
/// field names). Chip dedup is custom frontend logic, so PartialEq is not derived.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: SourceKind,
    pub title: String,
    pub url: Option<String>,
}

/// Payload emitted on the `quote-captured` event. `source` is null only if even
/// the frontmost app name could not be obtained.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuotePayload {
    pub text: String,
    pub source: Option<Source>,
}

/// Capture the source of the current selection.
#[cfg(target_os = "macos")]
pub fn capture_source() -> Option<Source> {
    let (app_name, bundle_id) = frontmost_app()?;
    let app_name = app_name.unwrap_or_else(|| "unknown".to_string());
    let bundle_id = bundle_id.unwrap_or_default();

    if let Some((url, title)) = browser_tab(&bundle_id) {
        return Some(Source {
            kind: SourceKind::Web,
            title,
            url: Some(url),
        });
    }
    Some(Source {
        kind: SourceKind::App,
        title: app_name,
        url: None,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn capture_source() -> Option<Source> {
    None
}

/// (localizedName, bundleIdentifier) of NSWorkspace.shared.frontmostApplication.
#[cfg(target_os = "macos")]
fn frontmost_app() -> Option<(Option<String>, Option<String>)> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let name = app.localizedName().map(|s| s.to_string());
    let bid = app.bundleIdentifier().map(|s| s.to_string());
    Some((name, bid))
}

/// Build a per-family osascript that returns `URL\nTitle` of the active tab,
/// or None if the bundle is not a supported browser. Uses `tell application id`
/// so localization of the app name cannot break the script.
fn browser_script(bundle_id: &str) -> Option<String> {
    let chromium = [
        "com.google.chrome",
        "com.brave.browser",
        "com.microsoft.edgemacos",
        "com.vivaldi.vivaldi",
    ];
    let body = if chromium.contains(&bundle_id) {
        // Chromium-family tabs expose `title` (not `name`).
        "set t to active tab of front window\n  return (URL of t) & linefeed & (title of t)"
    } else if bundle_id == "com.apple.safari" {
        // Safari documents expose `name`.
        "return (URL of front document) & linefeed & (name of front document)"
    } else {
        return None;
    };
    Some(format!(
        "tell application id \"{bundle_id}\"\n  {body}\nend tell"
    ))
}

/// Run the browser-tab osascript for `bundle_id`. Returns (url, title) on success.
fn browser_tab(bundle_id: &str) -> Option<(String, String)> {
    let script = browser_script(bundle_id)?;
    let out = run_osascript(script, Duration::from_secs(2))?;
    let (url, title) = out.split_once('\n')?;
    let url = url.trim();
    let title = title.trim();
    if url.is_empty() {
        return None;
    }
    Some((url.to_string(), title.to_string()))
}

/// Run `osascript -e <script>` with a hard timeout. Returns trimmed stdout on
/// success. Spawns a thread + channel so a hung script cannot freeze capture;
/// on timeout the osascript child is left to the OS (rare, best-effort).
fn run_osascript(script: String, timeout: Duration) -> Option<String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new("osascript").args(["-e", &script]).output();
        let _ = tx.send(out);
    });
    let output = rx.recv_timeout(timeout).ok()??;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_script_chromium() {
        let s = browser_script("com.google.chrome").unwrap();
        assert!(s.contains("active tab of front window"));
        assert!(s.contains("title of t"));
        assert!(s.contains("tell application id \"com.google.chrome\""));
    }

    #[test]
    fn browser_script_safari() {
        let s = browser_script("com.apple.safari").unwrap();
        assert!(s.contains("front document"));
        assert!(s.contains("name of front document"));
    }

    #[test]
    fn browser_script_unknown_is_none() {
        assert!(browser_script("org.mozilla.firefox").is_none());
    }

    #[test]
    fn payload_serializes_camel_case() {
        let p = QuotePayload {
            text: "hi".into(),
            source: Some(Source {
                kind: SourceKind::Web,
                title: "GitHub".into(),
                url: Some("https://github.com".into()),
            }),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            "{\"text\":\"hi\",\"source\":{\"kind\":\"web\",\"title\":\"GitHub\",\"url\":\"https://github.com\"}}"
        );
    }

    #[test]
    fn payload_null_source_serializes_null() {
        let p = QuotePayload { text: "hi".into(), source: None };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(json, "{\"text\":\"hi\",\"source\":null}");
    }
}
```

- [ ] **Step 3: Register the module in `lib.rs`**

In `src-tauri/src/lib.rs`, add `mod source;` to the module list (e.g. after `mod shortcuts;` or in alphabetical position). Do **not** remove `mod quote;` yet — Task 5 does that after `capture.rs`/`popup.rs` no longer reference it.

```rust
mod source;
```

- [ ] **Step 4: Confirm `serde_json` is available for the test**

`serde_json` is already in `[dependencies]` (`Cargo.toml:17`). No change needed.

- [ ] **Step 5: Run `cargo check` + the new tests**

Run: `cd src-tauri && cargo check && cargo test source::`
Expected: `cargo check` succeeds; the 5 `source` unit tests pass. If the objc2 API signatures are reported as `unsafe`, follow the version-bump note in Step 1 (bump all three crates together) and re-run.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/source.rs src-tauri/src/lib.rs
git commit -m "feat(source): add macOS source attribution module (NSWorkspace + osascript)"
```

---

## Task 3: `resolveMergeTarget` pure helper + tests

**Files:**
- Modify: `src/note/quote.ts` (append)
- Test: `src/note/quote.test.ts` (append)

**Interfaces:**
- Consumes: `blockRanges` from `./blocks/ranges`, `isQuoteCardBlock` from Task 1, `BlockRange` type.
- Produces: `MergeTarget` (`{ kind: "merge"; range: BlockRange } | { kind: "new" }`), `resolveMergeTarget(doc, caret): MergeTarget`.

- [ ] **Step 1: Append the failing tests to `src/note/quote.test.ts`**

```ts
import { resolveMergeTarget } from "./quote";

describe("resolveMergeTarget", () => {
  it("merges when caret is inside a [!quote] card", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n> second";
    // caret in the middle of the second body line
    const caret = doc.indexOf("second");
    const t = resolveMergeTarget(doc, caret);
    expect(t.kind).toBe("merge");
    if (t.kind === "merge") expect(t.range.from).toBe(0);
  });

  it("merges when caret is on the title line of a [!quote] card", () => {
    const doc = "> [!quote] [A](https://a)\n> first";
    const caret = doc.indexOf("[A]");
    expect(resolveMergeTarget(doc, caret).kind).toBe("merge");
  });

  it("merges when caret is in blank lines immediately after a card", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n\n\n";
    const caret = doc.length;
    const t = resolveMergeTarget(doc, caret);
    expect(t.kind).toBe("merge");
    if (t.kind === "merge") expect(doc.slice(t.range.from, t.range.to)).toContain("first");
  });

  it("does not merge when a non-quote block sits between the card and caret", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n\nplain paragraph\n\n";
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret).kind).toBe("new");
  });

  it("does not merge when the preceding block is a plain blockquote", () => {
    const doc = "> plain\n> text\n\n";
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret).kind).toBe("new");
  });

  it("new card when caret is in an empty doc", () => {
    expect(resolveMergeTarget("", 0).kind).toBe("new");
  });

  it("new card when caret is before the card", () => {
    const doc = "> [!quote] [A](https://a)\n> first";
    const caret = 0;
    // caret at the very start, no preceding block
    expect(resolveMergeTarget(doc, caret).kind).toBe("merge");
    // caret == 0 is inside the card (from == 0), so this is the inside case.
  });
});
```

> Note: the last case asserts the *inside* rule (caret 0 is within `[0, to]` of a card whose `from` is 0) — this is intentional and documents the boundary.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/note/quote.test.ts`
Expected: FAIL — `resolveMergeTarget` is not exported.

- [ ] **Step 3: Append the implementation to `src/note/quote.ts`**

```ts
import { blockRanges, type BlockRange } from "./blocks/ranges";

export type MergeTarget =
  | { kind: "merge"; range: BlockRange }
  | { kind: "new" };

/** Decide whether a capture at `caret` should merge into an existing `[!quote]`
 *  card (inside or immediately preceding, separated only by blank lines) or
 *  start a new card. Pure over (doc, caret) so it is unit-testable without a
 *  live CodeMirror. */
export function resolveMergeTarget(doc: string, caret: number): MergeTarget {
  const ranges = blockRanges(doc);

  // Inside case: caret within a quote-card block.
  for (const r of ranges) {
    if (r.from <= caret && caret <= r.to && isQuoteCardBlock(doc.slice(r.from, r.to))) {
      return { kind: "merge", range: r };
    }
  }

  // Adjacent case: the nearest preceding block is a quote card and only
  // whitespace separates its end from the caret.
  let prev: BlockRange | null = null;
  for (const r of ranges) {
    if (r.to < caret) prev = r;
    else break;
  }
  if (prev && isQuoteCardBlock(doc.slice(prev.from, prev.to))) {
    const between = doc.slice(prev.to, caret);
    if (between.trim() === "") {
      return { kind: "merge", range: prev };
    }
  }

  return { kind: "new" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/note/quote.test.ts`
Expected: PASS (all of Task 1 + Task 3 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/note/quote.ts src/note/quote.test.ts
git commit -m "feat(quote): add resolveMergeTarget pure helper with tests"
```

---

## Task 4: Wire `capture.rs` to emit the structured payload

**Files:**
- Modify: `src-tauri/src/capture.rs:50-75` (`run_capture`)

**Interfaces:**
- Consumes: `source::capture_source()`, `source::QuotePayload` from Task 2.
- Produces: `quote-captured` event now carries `QuotePayload` (was `String`).

- [ ] **Step 1: Replace the `format_clip` call in `run_capture`**

In `src-tauri/src/capture.rs`, change the body of `run_capture` (lines 62-67) from:

```rust
    let Some(trimmed) = read_selection_text() else {
        return;
    };

    let block = crate::quote::format_clip(&trimmed);
    let _ = app.emit_to("main", "quote-captured", block);
```

to:

```rust
    let Some(trimmed) = read_selection_text() else {
        return;
    };

    let source = crate::source::capture_source();
    let payload = crate::source::QuotePayload { text: trimmed, source };
    let _ = app.emit_to("main", "quote-captured", payload);
```

- [ ] **Step 2: `cargo check`**

Run: `cd src-tauri && cargo check`
Expected: succeeds. (`capture.rs` no longer references `crate::quote`; `quote.rs` is still registered in `lib.rs` but now only `popup.rs` uses it — handled in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/capture.rs
git commit -m "feat(capture): emit structured {text, source} quote-captured payload"
```

---

## Task 5: Update `popup.rs` + delete `quote.rs`

**Files:**
- Modify: `src-tauri/src/popup.rs` (`PopupCache`, `run_popup_capture`, `submit_popup_capture`, tests)
- Modify: `src-tauri/src/lib.rs` (remove `mod quote;`)
- Delete: `src-tauri/src/quote.rs`

**Interfaces:**
- Consumes: `source::capture_source()`, `source::Source`, `source::QuotePayload` from Task 2.
- Produces: `PopupCache` now caches `(String, Option<Source>)`; popup-originated captures emit `QuotePayload`.

- [ ] **Step 1: Rewrite `PopupCache` + its impl/tests in `popup.rs`**

Replace the `PopupCache` struct + impl + Default (lines 9-38 of `src-tauri/src/popup.rs`) with:

```rust
/// Holds the text + source captured by `run_popup_capture` until the user
/// clicks 「加入采集区」 (submit) or cancels. Single-slot cache: a new capture
/// overwrites any pending one.
pub struct PopupCache {
    text: Mutex<Option<String>>,
    source: Mutex<Option<crate::source::Source>>,
}

impl PopupCache {
    pub fn new() -> Self {
        Self {
            text: Mutex::new(None),
            source: Mutex::new(None),
        }
    }

    pub fn set(&self, text: String, source: Option<crate::source::Source>) {
        *self.text.lock().unwrap() = Some(text);
        *self.source.lock().unwrap() = source;
    }

    /// Take the cached (text, source), clearing both slots. Returns None if no text.
    pub fn take(&self) -> Option<(String, Option<crate::source::Source>)> {
        let text = self.text.lock().unwrap().take();
        let source = self.source.lock().unwrap().take();
        text.map(|t| (t, source))
    }

    pub fn clear(&self) {
        *self.text.lock().unwrap() = None;
        *self.source.lock().unwrap() = None;
    }
}

impl Default for PopupCache {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 2: Rewrite `submit_popup_capture`**

Replace the body of `submit_popup_capture` (lines 56-77) with:

```rust
/// User clicked 「加入采集区」: forward the cached {text, source} to the note
/// window exactly as the direct-capture path does.
#[tauri::command]
pub fn submit_popup_capture(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let (text, source) = match state.popup_cache.take() {
        Some((t, s)) if !t.trim().is_empty() => (t, s),
        _ => return Err("没有可加入的选中文本".to_string()),
    };
    let payload = crate::source::QuotePayload {
        text: text.trim().to_string(),
        source,
    };
    app.emit_to("main", "quote-captured", payload)
        .map_err(|e| format!("emit failed: {e}"))?;

    if let Some(window) = crate::windows::note_window(&app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    // Hide the popup window (do not destroy it).
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.hide();
    }
    Ok(())
}
```

- [ ] **Step 3: Update `run_popup_capture` to capture + cache source**

Replace the cache-store line inside `run_popup_capture` (lines 102-106) from:

```rust
    let text = crate::capture::read_selection_text(); // Option<String>
    let has_text = text.is_some();
    if let Some(ref t) = text {
        state_set(app, t.clone());
    }
```

to:

```rust
    let text = crate::capture::read_selection_text(); // Option<String>
    let has_text = text.is_some();
    if let Some(ref t) = text {
        // Source app is still frontmost here (popup window is shown only below).
        let source = crate::source::capture_source();
        state_set(app, t.clone(), source);
    }
```

- [ ] **Step 4: Update the `state_set` helper**

Replace `state_set` (lines 115-119) with:

```rust
/// Helper: stash the captured text + source into the managed AppState.
fn state_set(app: &AppHandle, text: String, source: Option<crate::source::Source>) {
    if let Some(state) = app.try_state::<AppState>() {
        state.popup_cache.set(text, source);
    }
}
```

- [ ] **Step 5: Update the `PopupCache` unit tests**

Replace the four tests in `popup.rs` `#[cfg(test)] mod tests` (lines 122-155) with:

```rust
    #[test]
    fn take_returns_none_when_empty() {
        let cache = PopupCache::new();
        assert!(cache.take().is_none());
    }

    #[test]
    fn set_then_take_roundtrips() {
        let cache = PopupCache::new();
        cache.set("hello".to_string(), None);
        let (t, s) = cache.take().unwrap();
        assert_eq!(t, "hello");
        assert!(s.is_none());
        // take clears the slot
        assert!(cache.take().is_none());
    }

    #[test]
    fn set_overwrites_previous() {
        let cache = PopupCache::new();
        cache.set("a".to_string(), None);
        cache.set("b".to_string(), None);
        assert_eq!(cache.take().unwrap().0, "b");
    }

    #[test]
    fn clear_drops_pending() {
        let cache = PopupCache::new();
        cache.set("x".to_string(), None);
        cache.clear();
        assert!(cache.take().is_none());
    }
```

- [ ] **Step 6: Remove `mod quote;` from `lib.rs`**

In `src-tauri/src/lib.rs`, delete the line `mod quote;`.

- [ ] **Step 7: Delete `quote.rs`**

Run: `rm src-tauri/src/quote.rs`

- [ ] **Step 8: `cargo check` + popup tests**

Run: `cd src-tauri && cargo check && cargo test popup::`
Expected: succeeds; popup tests pass. Confirm no remaining references: `grep -rn "quote::" src-tauri/src/` returns nothing.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/popup.rs src-tauri/src/lib.rs
git rm src-tauri/src/quote.rs
git commit -m "refactor(quote): move formatting to TS; popup caches+emits {text, source}"
```

---

## Task 6: Rewrite the `main.ts` `quote-captured` listener

**Files:**
- Modify: `src/note/main.ts:521-528`

**Interfaces:**
- Consumes: `QuotePayload` type, `resolveMergeTarget`, `mergeQuoteBlock`, `buildQuoteBlock` from `./quote`; `buildCaretInsert` from `./append`; `insertAtCaret` from `./editor`.

- [ ] **Step 1: Add the import**

In `src/note/main.ts`, add to the existing imports near the other `./note` imports (after the `append` import on line 8):

```ts
import { buildQuoteBlock, mergeQuoteBlock, resolveMergeTarget, type Source } from "./quote";
```

- [ ] **Step 2: Replace the listener**

Replace the `quote-captured` listener (lines 521-528) from:

```ts
void listen<string>("quote-captured", (event) => {
  const from = editor.state.selection.main.from;
  const before = editor.state.doc.sliceString(0, from);
  const after = editor.state.doc.sliceString(from);
  const insert = buildCaretInsert(before, after, event.payload);
  insertAtCaret(editor, insert);
  editor.focus();
});
```

with:

```ts
type QuotePayload = { text: string; source: Source | null };

void listen<QuotePayload>("quote-captured", (event) => {
  const { text, source } = event.payload;
  const doc = editor.state.doc.toString();
  const caret = editor.state.selection.main.from;
  const target = resolveMergeTarget(doc, caret);
  if (target.kind === "merge") {
    const existing = doc.slice(target.range.from, target.range.to);
    const merged = mergeQuoteBlock(existing, text, source);
    editor.dispatch({
      changes: { from: target.range.from, to: target.range.to, insert: merged },
      selection: { anchor: target.range.from + merged.length },
      scrollIntoView: true,
    });
  } else {
    const before = doc.slice(0, caret);
    const after = doc.slice(caret);
    const insert = buildCaretInsert(before, after, buildQuoteBlock(text, source));
    insertAtCaret(editor, insert);
  }
  editor.focus();
});
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: `tsc` succeeds (no type errors). (The build also runs the Vite frontend bundle; both should pass.)

- [ ] **Step 4: Commit**

```bash
git add src/note/main.ts
git commit -m "feat(main): rewrite quote-captured listener for merge-vs-new cards"
```

---

## Task 7: Card rendering in `preview.ts`

**Files:**
- Modify: `src/note/preview.ts` (imports, `QuoteMark` case ~170-181, add `QuoteCardWidget` + card-detection first pass + card frame/widget pass)
- Modify: `src/styles.css` (card classes)

**Interfaces:**
- Consumes: `parseChips`, `Source` from `./quote`; CodeMirror `Decoration`/`WidgetType`/`ViewPlugin`.

- [ ] **Step 1: Add the import**

In `src/note/preview.ts`, add at the top with the other imports:

```ts
import { parseChips, type Source } from "./quote";
```

- [ ] **Step 2: Add the `QuoteCardWidget` class**

Add after the `TableWidget` class (before `buildDecorations`, ~line 107):

```ts
class QuoteCardWidget extends WidgetType {
  constructor(readonly chipsStr: string) { super(); }
  eq(o: QuoteCardWidget): boolean { return o.chipsStr === this.chipsStr; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-quote-card-chips";
    const chips: Source[] = parseChips(this.chipsStr);
    chips.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "cm-quote-card-sep";
        sep.textContent = "·";
        span.appendChild(sep);
      }
      if (c.kind === "web" && c.url) {
        const a = document.createElement("a");
        a.className = "cm-quote-card-link";
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = c.title;
        span.appendChild(a);
      } else {
        const s = document.createElement("span");
        s.className = "cm-quote-card-app";
        s.textContent = c.title;
        span.appendChild(s);
      }
    });
    return span;
  }
  ignoreEvent() { return false; }
}
```

- [ ] **Step 3: Add a `cardLines` helper and precompute it in `buildDecorations`**

Inside `buildDecorations`, after `const doc = view.state.doc;` (line 112) and before the `syntaxTree` iterate, add a helper + set:

```ts
  // First pass: collect the line numbers that belong to a `[!quote]` card so
  // the QuoteMark handler can skip the plain-blockquote style on those lines.
  const cardLines = new Set<number>();
  const cardFirstLine = new Set<number>();
  const cardLastLine = new Map<number, number>(); // firstLine -> lastLine
  for (let pos = view.viewport.from; pos <= view.viewport.to && pos <= doc.length; ) {
    const line = doc.lineAt(pos);
    const startMatch = /^(>\s*)\[!quote\]/.exec(line.text);
    if (startMatch) {
      cardFirstLine.add(line.number);
      cardLines.add(line.number);
      let end = line;
      while (end.number < doc.lines && doc.lineAt(end.to + 1).startsWith(">")) {
        // guard against advancing past doc end
        if (end.to + 1 > doc.length) break;
        end = doc.lineAt(end.to + 1);
        cardLines.add(end.number);
      }
      cardLastLine.set(line.number, end.number);
      pos = end.to + 1;
    } else {
      pos = line.to + 1;
    }
  }
```

> Note: `doc.lineAt(end.to + 1)` is safe because the `while` guards `end.number < doc.lines` and the inner `break` guards past-end. A line whose text `startsWith(">")` includes the bare `>` separator line, matching `blockRanges` grouping.

- [ ] **Step 4: Skip `cm-preview-blockquote` on card lines in the `QuoteMark` case**

In the `QuoteMark` case (lines 170-181), change from:

```ts
        case "QuoteMark": {
          if (onCursorLine(node.from)) return false;
          let end = node.to;
          if (charAfter(end) === " ") end++;
          entries.push({ from: node.from, to: end, deco: hide });
          entries.push({
            from: lineStart(node.from),
            to: lineStart(node.from),
            deco: Decoration.line({ class: "cm-preview-blockquote" }),
          });
          return false;
        }
```

to:

```ts
        case "QuoteMark": {
          if (onCursorLine(node.from)) return false;
          let end = node.to;
          if (charAfter(end) === " ") end++;
          entries.push({ from: node.from, to: end, deco: hide });
          // Card lines get the card frame classes (added in the card pass below),
          // so skip the plain-blockquote line style for them.
          if (!cardLines.has(doc.lineAt(node.from).number)) {
            entries.push({
              from: lineStart(node.from),
              to: lineStart(node.from),
              deco: Decoration.line({ class: "cm-preview-blockquote" }),
            });
          }
          return false;
        }
```

- [ ] **Step 5: Add the card frame + title-widget pass**

After the callout-marker loop (and before `entries.sort(...)`), add:

```ts
  // `[!quote]` card frame + chip-row title widget. For every line of a card,
  // apply the card line background + left accent; first/last lines get rounded
  // corners. On the (non-cursor) title line, replace the chips portion with a
  // chip-row widget. The `> ` prefix is hidden by QuoteMark and the `[!quote] `
  // type marker is hidden by the callout-marker loop above, so the widget only
  // needs to cover the chips text itself — three adjacent, non-overlapping ranges.
  for (const firstLine of cardFirstLine) {
    const lastLine = cardLastLine.get(firstLine) ?? firstLine;
    for (let l = firstLine; l <= lastLine; l++) {
      const cl = doc.line(l);
      if (l < view.viewport.from || l > view.viewport.to) continue;
      entries.push({
        from: cl.from,
        to: cl.from,
        deco: Decoration.line({ class: "cm-quote-card-line" }),
      });
      if (l === firstLine) {
        entries.push({
          from: cl.from,
          to: cl.from,
          deco: Decoration.line({ class: "cm-quote-card-first" }),
        });
      }
      if (l === lastLine) {
        entries.push({
          from: cl.from,
          to: cl.from,
          deco: Decoration.line({ class: "cm-quote-card-last" }),
        });
      }
    }

    // Title-line chip widget (skip cursor line so the raw marker stays editable).
    // m[1] = `> [!quote] ` (quote marker + type + optional space) — exactly the
    // text already hidden by QuoteMark + the callout-marker loop. m[2] = chips.
    const titleLine = doc.line(firstLine);
    if (titleLine.from >= view.viewport.from && titleLine.to <= view.viewport.to &&
        !cursorLines.has(firstLine)) {
      const m = /^(>\s*\[!quote\]\s?)(.*)$/.exec(titleLine.text);
      if (m) {
        const chipStart = titleLine.from + m[1].length;
        entries.push({
          from: chipStart,
          to: titleLine.to,
          deco: Decoration.replace({ widget: new QuoteCardWidget(m[2]) }),
        });
      }
    }
  }
```

> Note: the callout-marker loop (lines 253-266) is **left unchanged** — it hides `[!quote] ` for `[!quote]` cards just as for any other callout. Combined with QuoteMark hiding `> ` and the widget replacing the chips text, the title line renders as just the chip row. Do not skip `[!quote]` in the callout loop: skipping would leave `[!quote] ` visible as a gap between the hidden `> ` and the chip widget.

- [ ] **Step 6: Add the CSS (light + dark) to `styles.css`**

Append to `src/styles.css`:

```css
/* ── Quote card (`> [!quote]`) ──────────────────────────────────────────── */
.cm-quote-card-line {
  background: #f5f5f4;
  border-left: 3px solid #c7c7c5;
  padding-left: 10px;
}
.cm-quote-card-first {
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}
.cm-quote-card-last {
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
}
.cm-quote-card-chips {
  font-size: 12px;
  color: #6b7280;
}
.cm-quote-card-sep {
  margin: 0 4px;
  color: #9ca3af;
}
.cm-quote-card-app {
  color: #6b7280;
}
.cm-quote-card-link {
  color: #2563eb;
  text-decoration: none;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: bottom;
  transition: opacity 150ms ease;
}
.cm-quote-card-link:hover {
  opacity: 0.7;
}

@media (prefers-color-scheme: dark) {
  .cm-quote-card-line {
    background: #2a2a29;
    border-left-color: #4a4a4a;
  }
  .cm-quote-card-chips,
  .cm-quote-card-app {
    color: #9ca3af;
  }
  .cm-quote-card-sep {
    color: #6b7280;
  }
  .cm-quote-card-link {
    color: #60a5fa;
  }
}
```

- [ ] **Step 7: Type-check + tests**

Run: `npm run build && npm test`
Expected: `tsc` + Vite build succeed; all Vitest tests pass (no preview tests exist, but the build validates the TS).

- [ ] **Step 8: Commit**

```bash
git add src/note/preview.ts src/styles.css
git commit -m "feat(preview): render quote cards with chip-row widget and card frame"
```

---

## Task 8: Manual verification + final gates

**Files:** none (verification only)

- [ ] **Step 1: Full build + test gates**

Run: `cd src-tauri && cargo check` then `npm test` then `npm run build`
Expected: all green.

- [ ] **Step 2: Manual flow checklist (`npm run tauri dev`)**

Walk through the spec's §9 manual checklist. Capture from Chrome (URL chip appears, click opens URL), capture again from the same tab (body appends, no new chip), capture from a different tab (second web chip), capture from Terminal (`终端` app chip), type a paragraph then capture (new card, adjacency broken), Safari (URL chip), Firefox (app chip only, fallback), first browser capture (deny Automation prompt → card still inserts with app-name chip), dark mode tokens, drag a merged card (moves as one unit), open `_inbox.md` in a text editor (human-readable `> [!quote] [title](url) · 终端` title line).

- [ ] **Step 3: Commit any fixups (if needed)**

Only if Steps 1–2 surfaced changes. Otherwise nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** §3.1 (source.rs, quote.ts, quote.test.ts) → Tasks 1–3. §3.2/§3.3 (capture.rs payload, main.ts listener, reuse of buildCaretInsert/insertAtCaret/blockRanges) → Tasks 4, 6. §3.4 (delete quote.rs) → Task 5. §4 data flow + §4.1 merge rule + §4.2 dedup → Tasks 1, 3, 6. §5 markdown format → Task 1 tests assert the exact examples. §6 rendering → Task 7. §7 styling tokens → Task 7 CSS. §8 edge cases → covered by Task 1/3 tests + Task 7 cursor-line handling + Task 2 fallbacks. §10 cross-platform → Task 2 `cfg(not(target_os = "macos"))`. §11 files touched → all accounted for, plus `popup.rs` (gap in spec §11 — see note).
- **Spec gap surfaced & resolved:** §11's Modified list omits `popup.rs`, but `submit_popup_capture` calls `crate::quote::format_clip` and emits a `String`. Deleting `quote.rs` (§3.4) + changing the payload (§3.3) would break it. Task 5 updates `popup.rs` to cache `(text, source)` in `run_popup_capture` (captured while the source app is still frontmost, per §3.3) and emit `QuotePayload` from `submit_popup_capture` — matching the spec's intent that both entry points emit the same `{text, source}` shape.
- **Type consistency:** `Source` shape is `{ kind: "web" | "app"; title: string; url: string | null }` on both sides (Rust serde camelCase/lowercase ↔ TS literal). `QuotePayload` is `{ text: string; source: Source | null }` both sides. `resolveMergeTarget` returns `{ kind: "merge"; range: BlockRange } | { kind: "new" }`, consumed in Task 6 with `target.kind === "merge"` and `target.range.from/to`. `MergeTarget`/`BlockRange` names match across Tasks 3 and 6.
- **Placeholder scan:** none — every code step shows full code; every command shows expected output.
