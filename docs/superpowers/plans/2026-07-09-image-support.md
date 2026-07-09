# Image Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste image bitmaps and drag-drop image files into FloatNote notes, store them in a per-directory `_assets/` folder, render them with resize/align/caption controls that write back to markdown source.

**Architecture:** Images are saved by new Rust commands into `<note-dir>/_assets/` and referenced via relative markdown paths `![](./_assets/x.png){width=400 .center}`. A custom Tauri URI scheme protocol (`floatnote-img://`) serves local image bytes with path-traversal validation, replacing the currently-broken `convertFileSrc` + asset-scope approach. The existing CodeMirror live-preview `ImgWidget` is extended to parse a `{...}` attribute block (width / `.left`/`.center`/`.right` / alt-as-caption) and render a `<figure>`. A click-to-activate toolbar with a drag resize handle, align buttons, and a caption input mutates the underlying markdown source via the syntax tree.

**Tech Stack:** Tauri 2 (Rust backend, `register_uri_scheme_protocol`), CodeMirror 6 + `@codemirror/lang-markdown`, Vanilla TypeScript + Vitest, `turndown` (already present). No new frontend deps; no new Tauri plugins.

## Global Constraints

- Storage rule verbatim: images land in "the `_assets/` subdirectory of the directory containing the `.md` file"; markdown reference is the relative path `./_assets/<filename>`.
- Attribute syntax verbatim: `![caption](url){width=400 .center}` — `width` first, then a single align class `.left`/`.center`/`.right`; caption is the alt text; default (no class) = left align.
- Image extension whitelist: `png, jpg, jpeg, gif, webp, svg, bmp, avif`.
- Single-image size cap: 20 MB (paste path only; base64 payload).
- No new capabilities: do NOT add `fs`, `clipboard-manager`, or `http` to `src-tauri/capabilities/default.json`. Paste uses the webview `paste` DOM event; drag-drop uses Tauri core `tauri://drag-drop`.
- Rust file ops for project-space images go in `src-tauri/src/notes.rs`; `commands.rs` only wires thin `#[tauri::command]` wrappers. Follow existing `write_atomic` + fsync pattern.
- TypeScript style: 2-space indent, double quotes, semicolons, ES modules, camelCase. Rust style: `rustfmt`, snake_case, serde-serializable payloads.
- Filename slug rule: spaces → `-`; other separators (`/`, `\`, `:`) → `-`; Chinese/Unicode letters preserved; extension preserved.
- Orphan rule: deleting an image link does NOT delete the file.
- Cross-platform: paths via `std::path::Path`; percent-encode absolute paths in the custom protocol URL so spaces/Chinese/Windows drive letters survive.

---

## File Structure

**Create:**
- `src/note/image-attrs.ts` — pure parsers/writers for the `{...}` attribute block and alt/caption. No DOM. Tested.
- `src/note/image-attrs.test.ts` — Vitest for the above.
- `src/note/image-fs.ts` — frontend helpers: filename slug/dedup, `savePastedImage`, `importImageFiles`, `imageSrc` (relative path → custom-protocol URL). Wraps `invoke`.
- `src/note/image-fs.test.ts` — Vitest for slug/dedup.
- `src/note/image-drop.ts` — CodeMirror DOM-event handler for `tauri://drag-drop` → insert links at caret.
- `src/note/image-toolbar.ts` — click-to-activate toolbar (resize handle / align / caption) that writes back to source.

**Modify:**
- `src-tauri/src/notes.rs` — add `unique_image_filename`, `save_pasted_image`, `import_image_files`, `is_safe_image_path`, `image_content_type`. Add `#[cfg(test)]` tests.
- `src-tauri/src/commands.rs` — thin `#[tauri::command]` wrappers `save_pasted_image`, `import_image_files`.
- `src-tauri/src/lib.rs` — register the `floatnote-img://` protocol on the builder; register the two new commands in `invoke_handler`.
- `src/note/preview.ts` — extend `ImgWidget` (parse attrs, render `<figure>`, custom-protocol `src`); extend the `Image` case in `buildDecorations` to consume the `{...}` block; add toolbar styles.
- `src/note/paste.ts` — add `imagePasteHandler()` extension (image bitmap → save → insert).
- `src/note/editor.ts` — wire `imagePasteHandler()` and `imageDropHandler()` into `createEditor`; thread a `noteDirProvider: () => string` through.
- `src/note/main.ts` — pass the per-editor `noteDirProvider` (project dir or standalone-doc parent dir) into `createEditor`.
- `src/styles.css` (or `previewTheme` in `preview.ts`) — figure/caption/align/toolbar/handle styles.

---

## Task 1: Rust image-storage primitives in `notes.rs`

**Files:**
- Modify: `src-tauri/src/notes.rs` (append new fns + tests)

**Interfaces:**
- Produces (used by Task 3 commands and Task 2 protocol):
  - `pub fn unique_image_filename(dir: &Path, stem: &str, ext: &str) -> String` — returns e.g. `"arch.png"` or `"arch-1.png"`.
  - `pub fn save_pasted_image(dir: &Path, suggested_stem: &str, data_base64: &str, mime: &str) -> std::io::Result<(String, String)>` — returns `(filename, rel_path)` where `rel_path = "./_assets/<filename>"`. Writes into `dir/_assets/`.
  - `pub fn import_image_files(source_paths: &[String], dir: &Path) -> Vec<(String, String, Option<String>)>` — per source: `(source_path, rel_path, error_or_none)`.
  - `pub fn is_safe_image_path(path: &Path) -> bool` — true iff canonicalized path's parent component is `_assets` and extension is in the whitelist.
  - `pub fn image_content_type(ext: &str) -> &'static str` — mime map.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/notes.rs` inside the existing `#[cfg(test)] mod tests` (after `mtime_millis_returns_some_for_existing_file`):

```rust
    use base64::Engine as _;

    #[test]
    fn unique_image_filename_no_conflict() {
        let dir = tempdir();
        assert_eq!(unique_image_filename(dir.path(), "arch", "png"), "arch.png");
    }

    #[test]
    fn unique_image_filename_appends_on_conflict() {
        let dir = tempdir();
        std::fs::write(dir.path().join("arch.png"), b"x").unwrap();
        assert_eq!(unique_image_filename(dir.path(), "arch", "png"), "arch-1.png");
        std::fs::write(dir.path().join("arch-1.png"), b"x").unwrap();
        assert_eq!(unique_image_filename(dir.path(), "arch", "png"), "arch-2.png");
    }

    #[test]
    fn save_pasted_image_decodes_and_writes_to_assets() {
        let dir = tempdir();
        // 1x1 transparent PNG
        let png = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
            .unwrap();
        let (filename, rel) =
            save_pasted_image(dir.path(), "paste-1", &base64::engine::general_purpose::STANDARD.encode(&png), "image/png")
                .unwrap();
        assert_eq!(filename, "paste-1.png");
        assert_eq!(rel, "./_assets/paste-1.png");
        let written = std::fs::read(dir.path().join("_assets").join("paste-1.png")).unwrap();
        assert_eq!(written, png);
    }

    #[test]
    fn import_image_files_copies_and_dedups() {
        let dir = tempdir();
        let src = dir.path().join("_src.png");
        std::fs::write(&src, b"img").unwrap();
        let target = dir.path().to_path_buf(); // _assets created inside
        let results = import_image_files(&[src.to_string_lossy().to_string()], &target);
        assert_eq!(results.len(), 1);
        let (_, rel, err) = &results[0];
        assert!(err.is_none(), "unexpected error: {err:?}");
        assert_eq!(rel, "./_assets/_src.png");
        assert_eq!(std::fs::read(dir.path().join("_assets").join("_src.png")).unwrap(), b"img");
        // Second import of same path dedups to -1.
        let results2 = import_image_files(&[src.to_string_lossy().to_string()], &target);
        let (_, rel2, _) = &results2[0];
        assert_eq!(rel2, "./_assets/_src-1.png");
    }

    #[test]
    fn import_image_files_rejects_non_image_ext() {
        let dir = tempdir();
        let src = dir.path().join("notes.txt");
        std::fs::write(&src, b"nope").unwrap();
        let results = import_image_files(&[src.to_string_lossy().to_string()], &dir.path());
        let (_, _, err) = &results[0];
        assert!(err.is_some());
    }

    #[test]
    fn is_safe_image_path_accepts_assets_inside() {
        let dir = tempdir();
        let p = dir.path().join("_assets").join("x.png");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        assert!(is_safe_image_path(&p));
    }

    #[test]
    fn is_safe_image_path_rejects_outside_assets() {
        let dir = tempdir();
        let p = dir.path().join("secret.md");
        std::fs::write(&p, b"x").unwrap();
        assert!(!is_safe_image_path(&p));
    }

    #[test]
    fn is_safe_image_path_rejects_traversal() {
        // /tmp/floatnote-.../_assets/../secret.png canonicalizes outside _assets
        let dir = tempdir();
        let assets = dir.path().join("_assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(dir.path().join("secret.png"), b"x").unwrap();
        let p = assets.join("..").join("secret.png");
        assert!(!is_safe_image_path(&p));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib notes::tests`
Expected: FAIL — functions `unique_image_filename` (image variant), `save_pasted_image`, `import_image_files`, `is_safe_image_path` not found / `base64` crate missing.

- [ ] **Step 3: Add the `base64` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
base64 = "0.22"
```

- [ ] **Step 4: Write minimal implementation**

Append to `src-tauri/src/notes.rs` (above the `#[cfg(test)]` block):

```rust
use base64::Engine as _;

/// Image extensions accepted by the import/drag-drop path.
pub const IMAGE_EXTS: &[&str] =
    &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

/// Per the spec: images live in `<note-dir>/_assets/`. This is the canonical
/// subdirectory name and also the safety gate for the custom protocol.
pub const ASSETS_DIR: &str = "_assets";

/// Unique filename for an image: `<stem>.<ext>`, or `<stem>-<n>.<ext>` on conflict.
pub fn unique_image_filename(dir: &Path, stem: &str, ext: &str) -> String {
    let ext = ext.trim_start_matches('.');
    let mut candidate = format!("{stem}.{ext}");
    let mut n = 1;
    while dir.join(ASSETS_DIR).join(&candidate).exists() {
        n += 1;
        candidate = format!("{stem}-{n}.{ext}");
    }
    candidate
}

/// MIME for an image extension (lowercased, no dot). Falls back to octet-stream.
pub fn image_content_type(ext: &str) -> &'static str {
    match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Decode a base64 image payload and atomically write it into `<dir>/_assets/<filename>`.
/// Returns `(filename, "./_assets/<filename>")`. Creates `_assets/` if missing.
pub fn save_pasted_image(
    dir: &Path,
    suggested_stem: &str,
    data_base64: &str,
    mime: &str,
) -> std::io::Result<(String, String)> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    let ext = mime_to_ext(mime).unwrap_or("png");
    let assets = dir.join(ASSETS_DIR);
    std::fs::create_dir_all(&assets)?;
    let filename = unique_image_filename(dir, suggested_stem, ext);
    let path = assets.join(&filename);
    // write_atomic is text-oriented (str); images are bytes, so write directly
    // with fsync, then the file is brand-new (no rename needed).
    {
        let mut file = std::fs::File::create(&path)?;
        file.write_all(&data)?;
        file.sync_all()?;
    }
    Ok((filename, format!("./{ASSETS_DIR}/{filename}")))
}

fn mime_to_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

/// Per-source import result: `(source_path, rel_path, error_or_none)`.
pub type ImportResult = (String, String, Option<String>);

/// Copy each source image file into `<dir>/_assets/` (deduped). Non-image
/// extensions and copy failures are recorded per-item, not fatal.
pub fn import_image_files(source_paths: &[String], dir: &Path) -> Vec<ImportResult> {
    let assets = dir.join(ASSETS_DIR);
    let _ = std::fs::create_dir_all(&assets);
    source_paths
        .iter()
        .map(|src| {
            let p = std::path::Path::new(src);
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            if !IMAGE_EXTS.contains(&ext.as_str()) {
                return (src.clone(), String::new(), Some("not an image".into()));
            }
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".into());
            let slug = slugify(&stem);
            let filename = unique_image_filename(dir, &slug, &ext);
            let dest = assets.join(&filename);
            match std::fs::copy(p, &dest) {
                Ok(_) => (src.clone(), format!("./{ASSETS_DIR}/{filename}"), None),
                Err(e) => (src.clone(), String::new(), Some(e.to_string())),
            }
        })
        .collect()
}

/// Replace path separators and spaces with `-`; preserve Unicode letters.
fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_whitespace() || c == '/' || c == '\\' || c == ':' {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Safety gate for the `floatnote-img://` protocol: the canonicalized path's
/// immediate parent must be `_assets` and its extension must be an image type.
/// Rejects `../` traversal and arbitrary-file reads.
pub fn is_safe_image_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return false;
    }
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    match canonical.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
        Some(name) => name == ASSETS_DIR,
        None => false,
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib notes::tests`
Expected: PASS — all new tests green.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/notes.rs src-tauri/Cargo.toml
git commit -m "feat: add image storage primitives (save/import/safe-path) in notes.rs"
```

---

## Task 2: Custom `floatnote-img://` URI protocol in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs` (register protocol on the builder)

**Interfaces:**
- Consumes: `notes::is_safe_image_path`, `notes::image_content_type` (Task 1).
- Produces: a registered URI scheme `floatnote-img://`. Frontend (Task 6) builds URLs of the form `floatnote-img://local/<percent-encoded-absolute-path>`; the handler reads the file bytes and returns them with the right `Content-Type`, after passing `is_safe_image_path`.

- [ ] **Step 1: Add the protocol registration**

In `src-tauri/src/lib.rs`, inside `pub fn run()`, chain `.register_uri_scheme_protocol(...)` on `tauri::Builder::default()` — place it immediately after `.plugin(tauri_plugin_autostart::init(...))` (before `.setup`):

```rust
        .register_uri_scheme_protocol("floatnote-img", |_ctx, request| {
            use std::path::PathBuf;
            // URI path is like "/<percent-encoded absolute path>". Strip the
            // leading "/", percent-decode, then validate + serve.
            let raw = request.uri().path();
            let encoded = raw.strip_prefix('/').unwrap_or(raw);
            let decoded = percent_encoding::percent_decode_str(encoded)
                .decode_utf8_lossy()
                .into_owned();
            let path = PathBuf::from(&decoded);
            if !crate::notes::is_safe_image_path(&path) {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::FORBIDDEN)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain")
                    .body("forbidden".as_bytes().to_vec())
                    .unwrap();
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            match std::fs::read(&path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        crate::notes::image_content_type(ext),
                    )
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain")
                    .body("not found".as_bytes().to_vec())
                    .unwrap(),
            }
        })
```

- [ ] **Step 2: Add the `percent-encoding` dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
percent-encoding = "2"
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly (the `tauri::http` re-export and `register_uri_scheme_protocol` are part of Tauri 2). If `tauri::http` is not found, use the `http` crate directly by adding `http = "1"` to `Cargo.toml` and replacing `tauri::http` with `http`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: register floatnote-img:// protocol to serve local image bytes safely"
```

---

## Task 3: Thin Tauri commands for save/import

**Files:**
- Modify: `src-tauri/src/commands.rs` (add two `#[tauri::command]` fns)
- Modify: `src-tauri/src/lib.rs` (register in `invoke_handler`)

**Interfaces:**
- Consumes: `notes::save_pasted_image`, `notes::import_image_files` (Task 1).
- Produces (called by frontend Task 7 / Task 8):
  - `save_pasted_image(project_dir: String, suggested_stem: String, data_base64: String, mime: String) -> Result<SaveImageResult, String>` where `SaveImageResult { filename: String, rel_path: String }`.
  - `import_image_files(source_paths: Vec<String>, project_dir: String) -> Vec<ImportImageResult>` where `ImportImageResult { source: String, rel_path: String, error: Option<String> }`.

- [ ] **Step 1: Add the result structs and commands in `commands.rs`**

Append near the other note commands in `src-tauri/src/commands.rs`:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageResult {
    pub filename: String,
    pub rel_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageResult {
    pub source: String,
    pub rel_path: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn save_pasted_image(
    project_dir: String,
    suggested_stem: String,
    data_base64: String,
    mime: String,
) -> Result<SaveImageResult, String> {
    let dir = std::path::Path::new(&project_dir);
    let (filename, rel_path) =
        notes::save_pasted_image(dir, &suggested_stem, &data_base64, &mime)
            .map_err(|e| e.to_string())?;
    Ok(SaveImageResult { filename, rel_path })
}

#[tauri::command]
pub fn import_image_files(
    source_paths: Vec<String>,
    project_dir: String,
) -> Vec<ImportImageResult> {
    let dir = std::path::Path::new(&project_dir);
    notes::import_image_files(&source_paths, dir)
        .into_iter()
        .map(|(source, rel_path, error)| ImportImageResult {
            source,
            rel_path,
            error,
        })
        .collect()
}
```

- [ ] **Step 2: Register the commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list (e.g. after `commands::list_notes,`):

```rust
            commands::save_pasted_image,
            commands::import_image_files,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add save_pasted_image + import_image_files commands"
```

---

## Task 4: Frontend attribute parse/writeback pure functions

**Files:**
- Create: `src/note/image-attrs.ts`
- Test: `src/note/image-attrs.test.ts`

**Interfaces:**
- Produces (used by Task 6 rendering and Task 7 toolbar):
  - `export type ImageAlign = "left" | "center" | "right";`
  - `export interface ImageAttrs { caption: string; url: string; width: number | null; align: ImageAlign | null; }`
  - `export function parseImage(raw: string): ImageAttrs | null` — input is the raw `![...](...){...}` text (no surrounding). Returns null if not an image.
  - `export function parseAttrBlock(textAfterUrl: string): { width: number | null; align: ImageAlign | null }` — parses a `{...}` block; tolerant of garbage (returns nulls on malformed).
  - `export function writeAttrs(attrs: ImageAttrs): string` — emits canonical `![caption](url){width=N .center}` (omits `{}` when width and align both null; omits class when null; omits width when null).
  - `export function slugifyImageName(name: string): string` — same rule as Rust `slugify` (Task 1). Used by Task 5.

- [ ] **Step 1: Write the failing tests**

`src/note/image-attrs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseImage, parseAttrBlock, writeAttrs, slugifyImageName } from "./image-attrs";

describe("parseImage", () => {
  it("parses caption url and attrs", () => {
    const a = parseImage("![图注](./_assets/arch.png){width=400 .center}")!;
    expect(a.caption).toBe("图注");
    expect(a.url).toBe("./_assets/arch.png");
    expect(a.width).toBe(400);
    expect(a.align).toBe("center");
  });

  it("works without attr block", () => {
    const a = parseImage("![alt](https://x.com/a.png)")!;
    expect(a.caption).toBe("alt");
    expect(a.url).toBe("https://x.com/a.png");
    expect(a.width).toBeNull();
    expect(a.align).toBeNull();
  });

  it("returns null for non-image", () => {
    expect(parseImage("[link](url)")).toBeNull();
  });
});

describe("parseAttrBlock", () => {
  it("parses width and class in order", () => {
    const r = parseAttrBlock("{width=400 .center}");
    expect(r).toEqual({ width: 400, align: "center" });
  });
  it("parses width only", () => {
    expect(parseAttrBlock("{width=250}")).toEqual({ width: 250, align: null });
  });
  it("parses align only", () => {
    expect(parseAttrBlock("{.right}")).toEqual({ width: null, align: "right" });
  });
  it("returns nulls on garbage", () => {
    expect(parseAttrBlock("{garbage}")).toEqual({ width: null, align: null });
  });
  it("returns nulls when no block", () => {
    expect(parseAttrBlock("")).toEqual({ width: null, align: null });
  });
});

describe("writeAttrs", () => {
  it("emits full canonical form", () => {
    expect(writeAttrs({ caption: "图注", url: "./_assets/a.png", width: 400, align: "center" }))
      .toBe("![图注](./_assets/a.png){width=400 .center}");
  });
  it("omits block when no width and no align", () => {
    expect(writeAttrs({ caption: "", url: "./_assets/a.png", width: null, align: null }))
      .toBe("![](./_assets/a.png)");
  });
  it("omits class when null", () => {
    expect(writeAttrs({ caption: "c", url: "u", width: 300, align: null }))
      .toBe("![c](u){width=300}");
  });
  it("omits width when null", () => {
    expect(writeAttrs({ caption: "c", url: "u", width: null, align: "left" }))
      .toBe("![c](u){.left}");
  });
});

describe("slugifyImageName", () => {
  it("replaces spaces and separators with dash, keeps unicode", () => {
    expect(slugifyImageName("截图 1")).toBe("截图-1");
    expect(slugifyImageName("a/b:c")).toBe("a-b-c");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/note/image-attrs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/note/image-attrs.ts`:

```ts
export type ImageAlign = "left" | "center" | "right";

export interface ImageAttrs {
  caption: string;
  url: string;
  width: number | null;
  align: ImageAlign | null;
}

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;

/** Parse a raw `![...](...)` image token (optionally followed by `{...}`).
 *  Returns null if the text does not start with an image. */
export function parseImage(raw: string): ImageAttrs | null {
  const m = IMAGE_RE.exec(raw);
  if (!m) return null;
  const caption = m[1] ?? "";
  const url = (m[2] ?? "").trim();
  const rest = raw.slice(m[0].length);
  const { width, align } = parseAttrBlock(rest.trim());
  return { caption, url, width, align };
}

/** Parse a `{width=N .align}` block. Tolerant: garbage or missing → nulls. */
export function parseAttrBlock(textAfterUrl: string): { width: number | null; align: ImageAlign | null } {
  const m = /^\{([^}]*)\}/.exec(textAfterUrl);
  if (!m) return { width: null, align: null };
  const body = m[1];
  const widthMatch = /\bwidth\s*=\s*(\d+)/.exec(body);
  const alignMatch = /\.(left|center|right)\b/.exec(body);
  return {
    width: widthMatch ? parseInt(widthMatch[1], 10) : null,
    align: alignMatch ? (alignMatch[1] as ImageAlign) : null,
  };
}

/** Emit canonical `![caption](url){width=N .align}`. Omit the block / parts
 *  that are null so plain images stay plain. */
export function writeAttrs(attrs: ImageAttrs): string {
  const cls = attrs.align ? `.${attrs.align}` : null;
  const w = attrs.width != null ? `width=${attrs.width}` : null;
  const parts = [w, cls].filter((p): p is string => p != null);
  const block = parts.length ? `{${parts.join(" ")}}` : "";
  return `![${attrs.caption}](${attrs.url})${block}`;
}

/** Same rule as Rust `slugify`: spaces and `/ \ :` → `-`, unicode preserved. */
export function slugifyImageName(name: string): string {
  return Array.from(name)
    .map((c) => (/\s|\/|\\|:/.test(c) ? "-" : c))
    .join("")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/note/image-attrs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/note/image-attrs.ts src/note/image-attrs.test.ts
git commit -m "feat: add image attribute parse/writeback helpers"
```

---

## Task 5: Frontend `image-fs.ts` (invoke wrappers + `imageSrc`)

**Files:**
- Create: `src/note/image-fs.ts`
- Test: `src/note/image-fs.test.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`; `slugifyImageName` (Task 4); Rust commands (Task 3).
- Produces (used by Task 6, 7, 8, 9):
  - `export async function savePastedImage(projectDir: string, blob: Blob): Promise<string>` — returns the markdown link `![](./_assets/...)` ready to insert (without attrs). Enforces 20 MB cap (throws).
  - `export async function importImageFiles(projectDir: string, paths: string[]): Promise<string[]>` — returns markdown links for successful imports (skips failures).
  - `export function imageSrc(url: string, noteDir: string): string` — `http(s)` → as-is; relative `./_assets/...` → `floatnote-img://local/<encoded abs path>`; absolute → encoded as-is.

- [ ] **Step 1: Write the failing tests**

`src/note/image-fs.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { imageSrc } from "./image-fs";

describe("imageSrc", () => {
  it("passes http(s) through", () => {
    expect(imageSrc("https://x.com/a.png", "/p")).toBe("https://x.com/a.png");
  });
  it("encodes a relative path to the floatnote-img protocol", () => {
    const url = imageSrc("./_assets/截图 1.png", "/Users/a/proj");
    expect(url.startsWith("floatnote-img://local/")).toBe(true);
    expect(decodeURIComponent(url.slice("floatnote-img://local/".length)))
      .toBe("/Users/a/proj/_assets/截图 1.png");
  });
  it("encodes an absolute path directly", () => {
    const url = imageSrc("/abs/_assets/x.png", "/p");
    expect(decodeURIComponent(url.slice("floatnote-img://local/".length)))
      .toBe("/abs/_assets/x.png");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/note/image-fs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/note/image-fs.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { slugifyImageName } from "./image-attrs";

const MAX_PASTE_BYTES = 20 * 1024 * 1024;

interface SaveImageResult { filename: string; relPath: string; }
interface ImportImageResult { source: string; relPath: string; error: string | null; }

/** Read a Blob to a base64 string (without the data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const dataUri = reader.result as string;
      const comma = dataUri.indexOf(",");
      resolve(comma >= 0 ? dataUri.slice(comma + 1) : dataUri);
    };
    reader.readAsDataURL(blob);
  });
}

/** Save a pasted image bitmap to `<projectDir>/_assets/` and return a markdown
 *  link `![](./_assets/...)`. Throws on >20 MB or backend failure. */
export async function savePastedImage(projectDir: string, blob: Blob): Promise<string> {
  if (blob.size > MAX_PASTE_BYTES) {
    throw new Error("图片过大（超过 20MB）");
  }
  const stem = `paste-${stamp()}`;
  const dataBase64 = await blobToBase64(blob);
  const result = await invoke<SaveImageResult>("save_pasted_image", {
    projectDir,
    suggestedStem: stem,
    dataBase64,
    mime: blob.type || "image/png",
  });
  return `![](${result.relPath})`;
}

/** Import dragged image file paths; return markdown links for successes only. */
export async function importImageFiles(projectDir: string, paths: string[]): Promise<string[]> {
  const results = await invoke<ImportImageResult[]>("import_image_files", {
    sourcePaths: paths,
    projectDir,
  });
  return results
    .filter((r) => !r.error && r.relPath)
    .map((r) => `![](${r.relPath})`);
}

/** Convert a markdown image url to a webview-loadable src.
 *  - http(s) → as-is
 *  - relative `./_assets/...` → resolved against noteDir, encoded
 *  - absolute → encoded as-is */
export function imageSrc(url: string, noteDir: string): string {
  if (/^https?:\/\//.test(url)) return url;
  let abs: string;
  if (url.startsWith("./") || url.startsWith("../")) {
    abs = joinPath(noteDir, url);
  } else {
    abs = url;
  }
  return "floatnote-img://local/" + encodeURIComponent(abs);
}

/** Join a base dir and a `./` / `../` relative path. Minimal, OS-agnostic. */
function joinPath(base: string, rel: string): string {
  const cleanRel = rel.replace(/^\.\//, "");
  const baseTrimmed = base.replace(/[\\/]+$/, "");
  return `${baseTrimmed}/${cleanRel}`.replace(/\\/g, "/");
}

/** Stable timestamp stamp for paste filenames (local time, no Date.now in hot path). */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// re-export so callers can build suggested stems from dropped filenames
export { slugifyImageName };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/note/image-fs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/note/image-fs.ts src/note/image-fs.test.ts
git commit -m "feat: add image-fs helpers (save/import/imageSrc)"
```

---

## Task 6: Extend `ImgWidget` + `buildDecorations` for attrs & protocol

**Files:**
- Modify: `src/note/preview.ts` (`ImgWidget`, the `Image` case, theme styles)
- Consumes: `parseImage`, `imageSrc` (Tasks 4–5).

**Interfaces:**
- Produces: rendered `<figure class="img-<align>">` with `<img>` + optional `<figcaption>`. The `{...}` block is consumed (hidden) so it does not show as raw text.
- Note: `ImgWidget` now needs `noteDir` to build the protocol URL. The plugin reads it from a module-level setter set by `editor.ts` (Task 10) — `setNoteDir(view, dir)`.

- [ ] **Step 1: Update `ImgWidget`**

Replace the `ImgWidget` class in `src/note/preview.ts` (lines ~65–76) with:

```ts
import { parseImage, type ImageAlign } from "./image-attrs";
import { imageSrc } from "./image-fs";

/** Per-editor note directory, set by editor.ts so ImgWidget can resolve
 *  relative `./_assets/...` paths into floatnote-img:// URLs. Keyed by the
 *  EditorView's DOM root so the inbox and piece editors don't collide. */
const noteDirs = new WeakMap<HTMLElement, string>();
export function setNoteDir(view: EditorView, dir: string): void {
  noteDirs.set(view.dom, dir);
}
function noteDirOf(view: EditorView): string {
  return noteDirs.get(view.dom) ?? "";
}

class ImgWidget extends WidgetType {
  constructor(readonly raw: string, readonly view: EditorView) { super(); }
  eq(o: ImgWidget): boolean { return o.raw === this.raw; }
  toDOM(): HTMLElement {
    const a = parseImage(this.raw);
    const figure = document.createElement("figure");
    const align: ImageAlign = a?.align ?? "left";
    figure.className = `cm-preview-figure img-${align}`;
    const img = document.createElement("img");
    img.className = "cm-preview-img";
    img.alt = a?.caption ?? "";
    const url = a?.url ?? "";
    img.src = imageSrc(url, noteDirOf(this.view));
    img.style.width = a?.width ? `${a.width}px` : "";
    figure.appendChild(img);
    if (a && a.caption) {
      const fig = document.createElement("figcaption");
      fig.className = "cm-preview-figcaption";
      fig.textContent = a.caption;
      figure.appendChild(fig);
    }
    return figure;
  }
  ignoreEvent() { return false; } // allow clicks for the toolbar (Task 7)
}
```

- [ ] **Step 2: Consume the `{...}` block in the `Image` case**

In `buildDecorations`, replace the `case "Image":` block (lines ~494–507) with:

```ts
        case "Image": {
          if (onCursorLine(node.from)) return false;
          const raw = doc.sliceString(node.from, node.to);
          // lang-markdown's Image node covers `![alt](url)` but NOT the trailing
          // `{...}` attr block (it's plain text). Extend the replacement to
          // include a `{...}` immediately following so it is hidden too.
          let to = node.to;
          const after = doc.sliceString(node.to, node.to + 1);
          if (after === "{") {
            const close = doc.sliceString(node.to).indexOf("}");
            if (close >= 0) to = node.to + close + 1;
          }
          const url = raw.match(/\(([^)]+)\)/)?.[1].trim() ?? "";
          if (url) {
            entries.push({
              from: node.from,
              to,
              deco: Decoration.replace({ widget: new ImgWidget(doc.sliceString(node.from, to), view) }),
            });
          }
          return false;
        }
```

- [ ] **Step 3: Add figure/caption styles to `previewTheme`**

In the `previewTheme` `EditorView.theme({...})` object, add (replace the existing `.cm-preview-img` entry with these):

```ts
  ".cm-preview-figure": { display: "flex", flexDirection: "column", alignItems: "flex-start", margin: "6px 0" },
  ".cm-preview-figure.img-center": { alignItems: "center" },
  ".cm-preview-figure.img-right": { alignItems: "flex-end" },
  ".cm-preview-img": { maxWidth: "100%", borderRadius: "4px", display: "block" },
  ".cm-preview-figcaption": { fontSize: "0.85em", color: "#6b7280", marginTop: "2px" },
```

- [ ] **Step 4: Typecheck + run tests**

Run: `npm run build` (tsc) and `npm test`
Expected: clean; existing preview tests (if any) still pass.

- [ ] **Step 5: Commit**

```bash
git add src/note/preview.ts
git commit -m "feat: render image attrs (figure/caption/align) via floatnote-img protocol"
```

---

## Task 7: Image toolbar (resize handle / align / caption writeback)

**Files:**
- Create: `src/note/image-toolbar.ts`
- Modify: `src/note/preview.ts` (attach toolbar on click)

**Interfaces:**
- Consumes: `parseImage`, `writeAttrs` (Task 4); CodeMirror `syntaxTree`; the `ImgWidget` figure DOM.
- Produces: a toolbar mounted over the activated image. On align click / resize release / caption blur, it locates the `Image` node in the syntax tree covering the widget and rewrites the source slice with `writeAttrs`.

- [ ] **Step 1: Implement the toolbar module**

`src/note/image-toolbar.ts`:

```ts
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { parseImage, writeAttrs, type ImageAlign, type ImageAttrs } from "./image-attrs";

let active: { view: EditorView; figure: HTMLElement; from: number; to: number; raw: string } | null = null;
let toolbarEl: HTMLElement | null = null;

/** Find the Image node (plus trailing `{...}`) whose widget produced `figure`,
 *  returning its [from, to] source range. */
function locateImageRange(view: EditorView, figure: HTMLElement): { from: number; to: number; raw: string } | null {
  let found: { from: number; to: number; raw: string } | null = null;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const raw = view.state.doc.sliceString(node.from, node.to);
      const url = raw.match(/\(([^)]+)\)/)?.[1].trim();
      if (!url) return;
      let to = node.to;
      if (view.state.doc.sliceString(node.to, node.to + 1) === "{") {
        const close = view.state.doc.sliceString(node.to).indexOf("}");
        if (close >= 0) to = node.to + close + 1;
      }
      // Match by checking the widget's DOM equivalence is hard without a map;
      // instead match by the url+caption parsed from the figure's img alt+src.
      const img = figure.querySelector("img");
      if (!img) return;
      const alt = img.alt;
      const parsed = parseImage(view.state.doc.sliceString(node.from, to));
      if (parsed && parsed.caption === alt) {
        found = { from: node.from, to, raw: view.state.doc.sliceString(node.from, to) };
      }
    },
  });
  return found;
}

function rewrite(view: EditorView, from: number, to: number, attrs: ImageAttrs): void {
  const next = writeAttrs(attrs);
  view.dispatch({ changes: { from, to, insert: next } });
}

function openToolbar(view: EditorView, figure: HTMLElement): void {
  closeToolbar();
  const range = locateImageRange(view, figure);
  if (!range) return;
  const attrs = parseImage(range.raw) ?? { caption: "", url: "", width: null, align: null };
  active = { view, figure, from: range.from, to: range.to, raw: range.raw };

  const bar = document.createElement("div");
  bar.className = "cm-img-toolbar";
  for (const al of ["left", "center", "right"] as ImageAlign[]) {
    const b = document.createElement("button");
    b.textContent = al === "left" ? "左" : al === "center" ? "中" : "右";
    b.onclick = (e) => {
      e.stopPropagation();
      const cur = parseImage(view.state.doc.sliceString(active!.from, active!.to)) ?? attrs;
      const nextAlign: ImageAlign | null = cur.align === al ? null : al;
      rewrite(view, active!.from, active!.to, { ...cur, align: nextAlign });
    };
    bar.appendChild(b);
  }

  // Caption input
  const input = document.createElement("input");
  input.className = "cm-img-caption-input";
  input.value = attrs.caption;
  input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); };
  input.oninput = () => {
    const cur = parseImage(view.state.doc.sliceString(active!.from, active!.to)) ?? attrs;
    rewrite(view, active!.from, active!.to, { ...cur, caption: input.value });
  };
  bar.appendChild(input);

  // Resize handle
  const handle = document.createElement("div");
  handle.className = "cm-img-resize-handle";
  bar.appendChild(handle);
  let dragging = false;
  let startX = 0;
  let startW = 0;
  const img = figure.querySelector("img")!;
  handle.onpointerdown = (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = img.offsetWidth;
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (!dragging) return;
    const w = Math.max(40, Math.round(startW + (e.clientX - startX)));
    img.style.width = `${w}px`;
  };
  handle.onpointerup = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    const w = Math.max(40, Math.round(startW + (e.clientX - startX)));
    const cur = parseImage(view.state.doc.sliceString(active!.from, active!.to)) ?? attrs;
    rewrite(view, active!.from, active!.to, { ...cur, width: w });
  };

  figure.classList.add("cm-img-active");
  figure.appendChild(bar);
  toolbarEl = bar;
}

function closeToolbar(): void {
  if (active) active.figure.classList.remove("cm-img-active");
  toolbarEl?.remove();
  toolbarEl = null;
  active = null;
}

/** Wire toolbar open/close onto an editor view. Call once per editor. */
export function attachImageToolbar(view: EditorView): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const figure = target.closest(".cm-preview-figure") as HTMLElement | null;
    if (figure) {
      e.stopPropagation();
      openToolbar(view, figure);
    } else {
      closeToolbar();
    }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeToolbar(); };
  view.dom.addEventListener("click", onClick);
  view.dom.addEventListener("keyup", onKey);
  return () => {
    view.dom.removeEventListener("click", onClick);
    view.dom.removeEventListener("keyup", onKey);
    closeToolbar();
  };
}
```

- [ ] **Step 2: Attach from `preview.ts`**

In `src/note/preview.ts`, export a helper that editors call, and ensure `ignoreEvent` on `ImgWidget` returns `false` (already done in Task 6). Add at the bottom of `preview.ts`:

```ts
export { attachImageToolbar } from "./image-toolbar";
```

(The actual `attachImageToolbar(view)` call is wired in Task 10's `createEditor`.)

- [ ] **Step 3: Add toolbar/handle styles**

Append to the `previewTheme` object in `preview.ts`:

```ts
  ".cm-preview-figure.cm-img-active": { outline: "2px solid #3b82f6", borderRadius: "4px" },
  ".cm-img-toolbar": {
    display: "flex", gap: "4px", alignItems: "center",
    background: "rgba(255,255,255,0.95)", border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "4px", padding: "2px 4px", marginTop: "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
  },
  ".cm-img-toolbar button": { border: "1px solid rgba(0,0,0,0.15)", borderRadius: "3px", background: "#fff", padding: "0 6px", cursor: "pointer" },
  ".cm-img-caption-input": { border: "1px solid rgba(0,0,0,0.15)", borderRadius: "3px", padding: "0 4px", fontSize: "0.8em", minWidth: "120px" },
  ".cm-img-resize-handle": { width: "12px", height: "12px", background: "#3b82f6", borderRadius: "2px", cursor: "nwse-resize", alignSelf: "flex-end" },
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/note/image-toolbar.ts src/note/preview.ts
git commit -m "feat: image toolbar (resize handle / align / caption) writing back to source"
```

---

## Task 8: Paste image bitmap handler

**Files:**
- Modify: `src/note/paste.ts` (add `imagePasteHandler`)
- Consumes: `savePastedImage` (Task 5).

**Interfaces:**
- Produces: `export function imagePasteHandler(getNoteDir: () => string): Extension` — on paste, if `clipboardData` has an `image/*` item, save it and insert `![](./_assets/...)` at the caret; otherwise return `false` to let `htmlPasteHandler` run.

- [ ] **Step 1: Add the handler in `paste.ts`**

Append to `src/note/paste.ts`:

```ts
import { savePastedImage } from "./image-fs";

/**
 * 粘贴图片位图：剪贴板含 image/* 时，落盘到 <noteDir>/_assets/ 并在光标处插入
 * `![](./_assets/...)`。无图片时返回 false 放行给 htmlPasteHandler。20MB 上限
 * 由 savePastedImage 强制；失败 toast 后不插入。
 */
export function imagePasteHandler(getNoteDir: () => string): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      let file: File | null = null;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          file = it.getAsFile();
          if (file) break;
        }
      }
      if (!file) return false;
      event.preventDefault();
      const dir = getNoteDir();
      if (!dir) return true;
      void savePastedImage(dir, file)
        .then((link) => {
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: `${link}\n` },
            selection: { anchor: from + link.length + 1 },
            userEvent: "input.paste",
            scrollIntoView: true,
          });
        })
        .catch((err) => {
          console.error("image paste failed", err);
          toast(err instanceof Error ? err.message : "图片粘贴失败");
        });
      return true;
    },
  });
}

function toast(msg: string): void {
  const el = document.createElement("div");
  el.className = "cm-toast";
  el.textContent = msg;
  el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;background:rgba(0,0,0,0.8);color:#fff;padding:6px 12px;border-radius:4px;z-index:9999;font-size:13px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/note/paste.ts
git commit -m "feat: paste image bitmaps into _assets and insert markdown link"
```

---

## Task 9: Drag-drop image files handler

**Files:**
- Create: `src/note/image-drop.ts`
- Consumes: `listen` from `@tauri-apps/api/event`; `importImageFiles` (Task 5).

**Interfaces:**
- Produces: `export function imageDropHandler(getNoteDir: () => string, getView: () => EditorView | null): () => Promise<void>` — listens to `tauri://drag-drop`; on drop, filters payload paths and inserts one `![](./_assets/...)` per line at the caret.

- [ ] **Step 1: Implement the handler**

`src/note/image-drop.ts`:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { importImageFiles } from "./image-fs";
import type { EditorView } from "@codemirror/view";

interface DragDropPayload { paths: string[]; position: { x: number; y: number } }

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** Listen for Tauri drag-drop; image files are imported into <noteDir>/_assets/
 *  and inserted at the caret. Returns an unlisten. */
export function imageDropHandler(
  getNoteDir: () => string,
  getView: () => EditorView | null,
): () => Promise<void> {
  let unlisten: UnlistenFn | null = null;
  const ready = listen<DragDropPayload>("tauri://drag-drop", async (event) => {
    const view = getView();
    const dir = getNoteDir();
    if (!view || !dir) return;
    const paths = (event.payload.paths ?? []).filter((p) => IMAGE_EXT_RE.test(p));
    if (!paths.length) return;
    try {
      const links = await importImageFiles(dir, paths);
      if (!links.length) return;
      const insert = links.map((l) => l).join("\n") + "\n";
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.drop",
        scrollIntoView: true,
      });
    } catch (err) {
      console.error("image drop failed", err);
    }
  });
  ready.then((fn) => { unlisten = fn; });
  return async () => { unlisten?.(); };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/note/image-drop.ts
git commit -m "feat: drag-drop image files into _assets and insert links"
```

---

## Task 10: Wire into `editor.ts` + `main.ts`

**Files:**
- Modify: `src/note/editor.ts` (add `imagePasteHandler`, `imageDropHandler`, `attachImageToolbar`, `setNoteDir` to `createEditor`).
- Modify: `src/note/main.ts` (pass `noteDirProvider` per editor).

**Interfaces:**
- Consumes: Tasks 6–9.
- Produces: a fully wired editor where each editor instance knows its note directory, pastes/drops images, and shows the toolbar.

- [ ] **Step 1: Update `createEditor` signature + wiring in `editor.ts`**

In `src/note/editor.ts`, change `createEditor` to accept a `noteDirProvider` and wire the new extensions. Replace the function:

```ts
import { imagePasteHandler } from "./paste";
import { imageDropHandler } from "./image-drop";
import { attachImageToolbar, setNoteDir } from "./preview";
// (htmlPasteHandler, livePreview imports unchanged)

export function createEditor(
  parent: HTMLElement,
  onChange: (doc: string) => void,
  extras: Extension[] = [],
  opts: { grow?: boolean; noteDirProvider?: () => string } = {},
): EditorView {
  const noteDirProvider = opts.noteDirProvider ?? (() => "");
  const view = new EditorView({
    parent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(highlight),
      ...livePreview(),
      imagePasteHandler(noteDirProvider),
      htmlPasteHandler(),
      buildTheme(opts.grow ?? false),
      EditorView.lineWrapping,
      ...extras,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  setNoteDir(view, noteDirProvider());
  // Keep the note dir fresh as the user switches projects/documents.
  const updateDir = () => setNoteDir(view, noteDirProvider());
  view.dom.addEventListener("focusin", updateDir);
  const unlistenDrop = imageDropHandler(noteDirProvider, () => view);
  const detachToolbar = attachImageToolbar(view);
  // Best-effort cleanup storage (editors are long-lived; stored on the view).
  (view as unknown as { __cleanup?: () => void }).__cleanup = async () => {
    detachToolbar();
    await unlistenDrop();
  };
  // Refresh dir immediately on each selection change too.
  return view;
}
```

Also add a small poll/refresh: because `noteDirProvider()` may change when the user switches pieces without a focusin event, call `setNoteDir` from an `EditorView.updateListener` instead. Replace the `focusin` line with an additional updateListener entry inside `extensions`:

```ts
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.focusChanged) setNoteDir(view, noteDirProvider());
      }),
```

(Keep one `setNoteDir` call after construction; remove the `focusin` listener to avoid duplication.)

- [ ] **Step 2: Pass `noteDirProvider` from `main.ts`**

In `src/note/main.ts`, the inbox editor is created via `createEditor(editorRoot, ...)` (line ~210) and the piece editor similarly. For each, pass `noteDirProvider`:

- Inbox/piece (project mode): the note dir is the current project's directory. Use `() => currentProject?.path ?? currentStartDir`.
- Standalone document mode: the note dir is the document file's parent directory. Use `() => currentDocument?.path ? parentDir(currentDocument.path) : currentStartDir`.

Add a helper near the top of `main.ts`:

```ts
function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : path;
}
```

Pass `noteDirProvider` into both `createEditor` calls. For the inbox editor (line ~210) add as the 4th arg:

```ts
  { noteDirProvider: () => currentProject?.path ?? currentStartDir },
```

And for the piece editor and document editor similarly (project mode uses `currentProject?.path`; document mode uses the document parent dir). If both piece and document share the `pieceEditor` instance, use a provider that branches on `mode`:

```ts
  { noteDirProvider: () => mode === "document" && currentDocument
      ? parentDir(currentDocument.path)
      : (currentProject?.path ?? currentStartDir) },
```

- [ ] **Step 3: Typecheck + run tests**

Run: `npm run build && npm test`
Expected: clean; all tests pass.

- [ ] **Step 4: Manual end-to-end check (macOS)**

Run: `npm run tauri dev`
- Open a project; in inbox, Cmd-V a screenshot → image renders, `./_assets/paste-*.png` link inserted.
- Drag a PNG from Finder into the piece editor → image renders.
- Click the image → toolbar appears; click 中/右 → align changes; drag handle → width changes; type in caption input → caption shows below.
- Verify `_assets/` was created in the project dir and the file exists.
- Open a standalone document and repeat paste → `_assets/` created next to the document.

- [ ] **Step 5: Commit**

```bash
git add src/note/editor.ts src/note/main.ts
git commit -m "feat: wire image paste/drop/toolbar + noteDirProvider into editors"
```

---

## Self-Review (run after writing, fix inline)

**Spec coverage:**
- §1 storage & paths → Task 1 (`unique_image_filename`, `_assets`), Task 5 (`imageSrc` resolves `./_assets`). ✓
- §2 paste + drag-drop → Tasks 8, 9, 5. ✓
- §3 rendering & attribute syntax → Tasks 4, 6. ✓
- §4 toolbar (resize/align/caption) → Task 7. ✓
- §5 backend commands + custom protocol + no new caps → Tasks 1, 2, 3. ✓
- §6 errors (20MB, missing-file placeholder, per-item failures) → Task 5 (20MB), Task 1 (per-item error), Task 6 (protocol 404 → broken img). ✓
- §6 testing (frontend pure fns, Rust tests, manual) → each task has tests; Task 10 manual. ✓

**Placeholder scan:** none — all steps have concrete code/commands.

**Type consistency:** `SaveImageResult.relPath` (camelCase via serde) ↔ frontend `relPath` ✓. `ImportImageResult` ↔ frontend ✓. `imageSrc` / `parseImage` / `writeAttrs` signatures consistent across Tasks 4–7 ✓. `attachImageToolbar` / `setNoteDir` exported from `preview.ts` and imported in `editor.ts` ✓.

**Scope:** single coherent feature, one plan. No decomposition needed.
