# FloatNote v1 Implementation Plan


**Goal:** Build a macOS tray-only, always-on-top floating Markdown note app where a global shortcut appends the current text selection (from any app) as a blockquote into the current note, with notes stored as Markdown files in a user-chosen directory.

**Architecture:** Tauri v2 desktop app. Rust backend owns the tray, two windows (note + settings), global shortcuts, selection capture (simulate Cmd+C via `enigo`, read/restore clipboard via `arboard`), Markdown file I/O, and config. Pure logic (quote formatting, timestamp filenames, directory scan, config defaults) lives in small testable Rust modules. The capture flow formats the quote in Rust and **emits an event to the note window**; the frontend inserts it into the live CodeMirror buffer and autosaves — so the editor buffer stays the single source of truth and there is no file/buffer race. Frontend is Vanilla TS + Vite (two HTML entry points), CodeMirror 6 editor, Phosphor icons.

**Tech Stack:** Tauri v2, Rust (`enigo`, `arboard`, `chrono`, `serde`), `tauri-plugin-global-shortcut`, `tauri-plugin-dialog`, `tauri-plugin-autostart`; Vanilla TypeScript, Vite, CodeMirror 6, `@phosphor-icons/web`; tests via `cargo test` (Rust) and `vitest` (frontend).

**Spec:** `docs/superpowers/specs/2026-06-08-floatnote-v1-design.md`

---

## File Structure

```
FloatNote/
├── package.json                 # frontend deps + scripts
├── vite.config.ts               # multi-page (index + settings) + vitest config
├── tsconfig.json
├── index.html                   # note window entry
├── settings.html                # settings window entry
├── src/
│   ├── note/
│   │   ├── main.ts              # note window bootstrap
│   │   ├── topbar.ts            # dir name / note name menu / new button
│   │   ├── editor.ts            # CodeMirror setup + native theme
│   │   ├── notes-state.ts       # current dir/note state, autosave, list
│   │   └── append.ts            # buildAppendInsert() pure fn (tested)
│   ├── settings/
│   │   └── main.ts             # settings form
│   └── styles.css
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── icons/                   # app + tray icons
│   └── src/
│       ├── main.rs             # entry → calls lib run()
│       ├── lib.rs              # builder: plugins, setup, commands, accessory policy
│       ├── quote.rs           # format_quote() (tested)
│       ├── notes.rs           # timestamp_filename, unique_filename, list_markdown, rename_note (tested)
│       ├── config.rs          # Config struct + load/save (tested)
│       ├── commands.rs        # Tauri command wrappers
│       ├── tray.rs            # tray icon + menu + left-click toggle
│       ├── windows.rs         # show/hide/toggle helpers for note & settings
│       ├── shortcuts.rs       # register/re-register global shortcuts
│       └── capture.rs         # enigo Cmd+C + arboard backup/read/restore
└── docs/superpowers/{specs,plans}/
```

---

## Task 1: Scaffold Tauri v2 + Vanilla TS project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `settings.html`, `src/note/main.ts`, `src/settings/main.ts`, `src/styles.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules
dist
src-tauri/target
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "floatnote",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "@codemirror/lang-markdown": "^6.3.0",
    "@codemirror/language": "^6.10.0",
    "@codemirror/state": "^6.4.0",
    "@codemirror/view": "^6.34.0",
    "@lezer/highlight": "^1.2.0",
    "@phosphor-icons/web": "^2.1.1",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "codemirror": "^6.0.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vite.config.ts`** (multi-page + vitest)

```typescript
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 5: Create `index.html` and `settings.html`**

`index.html`:
```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FloatNote</title>
    <link rel="stylesheet" href="/node_modules/@phosphor-icons/web/src/regular/style.css" />
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/note/main.ts"></script>
  </body>
</html>
```

`settings.html`:
```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FloatNote 设置</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/settings/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create placeholder entry scripts and styles**

`src/note/main.ts`:
```typescript
document.querySelector("#app")!.textContent = "FloatNote note window";
```

`src/settings/main.ts`:
```typescript
document.querySelector("#app")!.textContent = "FloatNote settings";
```

`src/styles.css`:
```css
:root { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
```

- [ ] **Step 7: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "floatnote"
version = "0.1.0"
edition = "2021"

[lib]
name = "floatnote_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-dialog = "2"
tauri-plugin-autostart = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = "0.4"
enigo = "0.2"
arboard = "3"
```

- [ ] **Step 8: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 9: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "FloatNote",
  "version": "0.1.0",
  "identifier": "com.floatnote.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "FloatNote",
        "width": 380,
        "height": 520,
        "visible": false,
        "alwaysOnTop": true,
        "url": "index.html"
      },
      {
        "label": "settings",
        "title": "FloatNote 设置",
        "width": 420,
        "height": 340,
        "visible": false,
        "url": "settings.html"
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "app",
    "icon": ["icons/icon.png"]
  }
}
```

- [ ] **Step 10: Create app/tray icons**

Run: `npx @tauri-apps/cli icon` is interactive; instead generate a 512×512 PNG placeholder and place at `src-tauri/icons/icon.png`, plus a 32×32 monochrome template at `src-tauri/icons/tray.png`. Use any solid square PNG for now (real art is out of scope). Command to make a plain icon:
```bash
mkdir -p src-tauri/icons
# create a 512x512 solid PNG using sips on a generated bitmap, or copy any existing png:
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 --decode > /tmp/px.png
sips -z 512 512 /tmp/px.png --out src-tauri/icons/icon.png
sips -z 32 32 /tmp/px.png --out src-tauri/icons/tray.png
```
(Replace with real artwork later.)

- [ ] **Step 11: Create `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    floatnote_lib::run()
}
```

- [ ] **Step 12: Create minimal `src-tauri/src/lib.rs`**

```rust
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
```

- [ ] **Step 13: Install and run dev to verify scaffold**

Run: `npm install && npm run tauri dev`
Expected: app compiles; a hidden `main` window exists (nothing visible yet — that's correct since `visible: false`). Stop with Ctrl+C. Temporarily set `main` window `"visible": true` to confirm the webview shows "FloatNote note window", then set it back to `false`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 + Vanilla TS project"
```

---

## Task 2: Quote formatting (Rust, TDD)

**Files:**
- Create: `src-tauri/src/quote.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod quote;`)

- [ ] **Step 1: Write failing tests** — create `src-tauri/src/quote.rs`:

```rust
/// Format selected text as a Markdown blockquote: every line gets a "> " prefix
/// (empty lines become a bare ">").
pub fn format_quote(text: &str) -> String {
    text.lines()
        .map(|line| if line.is_empty() { ">".to_string() } else { format!("> {line}") })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line() {
        assert_eq!(format_quote("hello"), "> hello");
    }

    #[test]
    fn multi_line() {
        assert_eq!(format_quote("a\nb"), "> a\n> b");
    }

    #[test]
    fn blank_line_in_middle() {
        assert_eq!(format_quote("a\n\nb"), "> a\n>\n> b");
    }

    #[test]
    fn trailing_newline_ignored() {
        assert_eq!(format_quote("a\n"), "> a");
    }
}
```

- [ ] **Step 2: Register module** — in `src-tauri/src/lib.rs` add at top:

```rust
mod quote;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test quote`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: markdown blockquote formatting"
```

---

## Task 3: Timestamp + unique filenames (Rust, TDD)

**Files:**
- Create: `src-tauri/src/notes.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod notes;`)

- [ ] **Step 1: Write failing tests + implementation** — create `src-tauri/src/notes.rs`:

```rust
use std::path::Path;
use chrono::NaiveDateTime;

/// Base note filename (no extension) from a timestamp: "2026-06-08 14-30".
pub fn timestamp_stem(now: NaiveDateTime) -> String {
    now.format("%Y-%m-%d %H-%M").to_string()
}

/// Given a directory and a desired stem, return a `<stem>.md` filename that does
/// not collide with an existing file, appending " 2", " 3", ... as needed.
pub fn unique_filename(dir: &Path, stem: &str) -> String {
    let mut candidate = format!("{stem}.md");
    let mut n = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{stem} {n}.md");
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn stem_format() {
        let dt = NaiveDate::from_ymd_opt(2026, 6, 8).unwrap().and_hms_opt(14, 30, 0).unwrap();
        assert_eq!(timestamp_stem(dt), "2026-06-08 14-30");
    }

    #[test]
    fn unique_when_no_conflict() {
        let dir = tempdir();
        assert_eq!(unique_filename(dir.path(), "note"), "note.md");
    }

    #[test]
    fn unique_appends_suffix_on_conflict() {
        let dir = tempdir();
        std::fs::write(dir.path().join("note.md"), "x").unwrap();
        assert_eq!(unique_filename(dir.path(), "note"), "note 2.md");
        std::fs::write(dir.path().join("note 2.md"), "x").unwrap();
        assert_eq!(unique_filename(dir.path(), "note"), "note 3.md");
    }

    fn tempdir() -> std::path::PathBuf { unreachable!() } // replaced in Step 2
}
```

- [ ] **Step 2: Add a tempdir helper without extra deps** — replace the `tempdir()` test helper with one that uses `std::env::temp_dir` and a unique subdir:

```rust
    fn tempdir() -> TempDir {
        let mut p = std::env::temp_dir();
        p.push(format!("floatnote-test-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }

    struct TempDir(std::path::PathBuf);
    impl TempDir { fn path(&self) -> &std::path::Path { &self.0 } }
    impl Drop for TempDir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
```
(Remove the placeholder `fn tempdir() -> PathBuf` line. Update the two tests that call `dir.path()` — they already do.)

- [ ] **Step 3: Register module** — in `src-tauri/src/lib.rs` add:

```rust
mod notes;
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test notes`
Expected: `stem_format`, `unique_when_no_conflict`, `unique_appends_suffix_on_conflict` pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: timestamp and unique note filenames"
```

---

## Task 4: List + rename notes (Rust, TDD)

**Files:**
- Modify: `src-tauri/src/notes.rs`

- [ ] **Step 1: Add `NoteEntry`, `list_markdown`, `rename_note` with tests** — append to `src-tauri/src/notes.rs` (above the `#[cfg(test)]` block for the fns, and add tests inside the existing `tests` module):

```rust
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteEntry {
    pub name: String, // filename without .md
    pub path: String, // absolute path
}

/// List `.md` files in `dir`, newest-modified first.
pub fn list_markdown(dir: &Path) -> std::io::Result<Vec<NoteEntry>> {
    let mut entries: Vec<(std::time::SystemTime, NoteEntry)> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let modified = entry.metadata()?.modified()?;
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            entries.push((modified, NoteEntry { name, path: path.to_string_lossy().to_string() }));
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, e)| e).collect())
}

/// Rename a note file within `dir`. Errors if `new_stem.md` already exists.
pub fn rename_note(dir: &Path, old_name: &str, new_stem: &str) -> std::io::Result<String> {
    let target = dir.join(format!("{new_stem}.md"));
    if target.exists() {
        return Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "target exists"));
    }
    std::fs::rename(dir.join(format!("{old_name}.md")), &target)?;
    Ok(target.to_string_lossy().to_string())
}
```

Add these tests inside the `tests` module:

```rust
    #[test]
    fn lists_only_markdown_sorted_newest_first() {
        let dir = tempdir();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(dir.path().join("b.md"), "2").unwrap();
        std::fs::write(dir.path().join("ignore.txt"), "x").unwrap();
        let names: Vec<String> = list_markdown(dir.path()).unwrap()
            .into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn rename_succeeds_and_errors_on_conflict() {
        let dir = tempdir();
        std::fs::write(dir.path().join("old.md"), "x").unwrap();
        rename_note(dir.path(), "old", "new").unwrap();
        assert!(dir.path().join("new.md").exists());
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        assert!(rename_note(dir.path(), "a", "new").is_err());
    }
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test notes`
Expected: all notes tests pass (5 total).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: list and rename notes"
```

---

## Task 5: Config with serde defaults (Rust, TDD)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod config;`)

- [ ] **Step 1: Write config + tests** — create `src-tauri/src/config.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct Config {
    pub working_dir: Option<String>,
    pub shortcut_capture: String,
    pub shortcut_toggle: String,
    pub font_size: u32,
    pub launch_at_login: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            working_dir: None,
            shortcut_capture: "Alt+Cmd+C".to_string(),
            shortcut_toggle: "Alt+Cmd+N".to_string(),
            font_size: 15,
            launch_at_login: false,
        }
    }
}

pub fn load(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(path: &Path, cfg: &Config) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(cfg).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_json_yields_defaults() {
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn partial_json_keeps_other_defaults() {
        let cfg: Config = serde_json::from_str(r#"{"font_size": 20}"#).unwrap();
        assert_eq!(cfg.font_size, 20);
        assert_eq!(cfg.shortcut_capture, "Alt+Cmd+C");
    }

    #[test]
    fn roundtrip() {
        let mut cfg = Config::default();
        cfg.working_dir = Some("/tmp/x".to_string());
        let s = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<Config>(&s).unwrap(), cfg);
    }
}
```

- [ ] **Step 2: Register module** — in `src-tauri/src/lib.rs` add:

```rust
mod config;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test config`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: config with serde defaults"
```

---

## Task 6: Tauri commands for notes + config

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

These are thin wrappers over Task 2–5 logic, exposed to the frontend. Shared state holds the config + its file path.

- [ ] **Step 1: Create `src-tauri/src/commands.rs`**

```rust
use crate::{config::Config, notes};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_working_dir(state: State<AppState>, dir: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.working_dir = Some(dir);
    crate::config::save(&state.config_path, &cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notes(dir: String) -> Result<Vec<notes::NoteEntry>, String> {
    notes::list_markdown(std::path::Path::new(&dir)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_note(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(dir: String) -> Result<notes::NoteEntry, String> {
    let dir_path = std::path::PathBuf::from(&dir);
    std::fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    let stem = notes::timestamp_stem(chrono::Local::now().naive_local());
    let filename = notes::unique_filename(&dir_path, &stem);
    let path = dir_path.join(&filename);
    std::fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(notes::NoteEntry {
        name: filename.trim_end_matches(".md").to_string(),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn rename_note(dir: String, old_name: String, new_stem: String) -> Result<String, String> {
    notes::rename_note(std::path::Path::new(&dir), &old_name, &new_stem)
        .map_err(|e| e.to_string())
}

/// Resolve the config file path under the app config dir.
pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap().join("config.json")
}
```

- [ ] **Step 2: Wire state, plugins, and handlers in `src-tauri/src/lib.rs`**

```rust
mod quote;
mod notes;
mod config;
mod commands;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let path = commands::config_path(app.handle());
            let cfg = config::load(&path);
            app.manage(AppState { config: Mutex::new(cfg), config_path: path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_working_dir,
            commands::list_notes,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::rename_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloatNote");
}
```

- [ ] **Step 3: Add capability permissions** — create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "FloatNote default capabilities",
  "windows": ["main", "settings"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-always-on-top",
    "core:event:default",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 4: Verify it compiles and commands are callable**

Run: `cd src-tauri && cargo build`
Expected: compiles. Then `npm run tauri dev`, temporarily set `main` window `visible: true`, open its devtools (right-click → Inspect, or add `"devtools": true`), and in the console run:
```js
await window.__TAURI__?.core?.invoke("get_config")
```
Since `withGlobalTauri` is false, instead add a temporary line in `src/note/main.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
console.log(await invoke("get_config"));
```
Expected: logs the default config object. Revert the temporary `visible: true` and the log line afterward.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tauri commands for notes and config"
```

---

## Task 7: Tray icon + accessory policy + window toggle

**Files:**
- Create: `src-tauri/src/tray.rs`, `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/windows.rs`**

```rust
use tauri::{AppHandle, Manager, WebviewWindow};

pub fn note_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

pub fn toggle_note(app: &AppHandle) {
    if let Some(win) = note_window(app) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/tray.rs`**

```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::{AppHandle, Manager};

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏笔记", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => crate::windows::toggle_note(app),
            "settings" => crate::windows::show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::windows::toggle_note(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
```

- [ ] **Step 3: Wire tray + accessory policy in `lib.rs` setup**

Add `mod tray;` and `mod windows;` near the other `mod` lines. In the `.setup(|app| { ... })` closure, after `app.manage(...)`, add:

```rust
            #[cfg(target_os = "macos")]
            app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray::build_tray(app.handle())?;
```

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`
Expected:
- No icon in the Dock.
- A tray icon appears in the macOS menu bar.
- Left-clicking the tray icon toggles the note window (shows the always-on-top window, click again hides it).
- Right-clicking the tray icon shows the menu; "设置…" shows the settings window; "退出" quits.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tray icon, accessory policy, window toggle"
```

---

## Task 8: Global shortcuts (toggle + capture trigger)

**Files:**
- Create: `src-tauri/src/shortcuts.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/shortcuts.rs`**

```rust
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use std::str::FromStr;

/// Register the toggle + capture shortcuts. Unregisters everything first so this
/// can be called again after the user changes bindings in settings.
pub fn apply(app: &AppHandle, capture: &str, toggle: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let capture_sc = Shortcut::from_str(capture).map_err(|e| format!("capture: {e:?}"))?;
    let toggle_sc = Shortcut::from_str(toggle).map_err(|e| format!("toggle: {e:?}"))?;

    let app_handle = app.clone();
    gs.on_shortcut(capture_sc, move |_app, _sc, event| {
        if event.state() == ShortcutState::Pressed {
            crate::capture::run_capture(&app_handle);
        }
    }).map_err(|e| format!("register capture: {e:?}"))?;

    let app_handle2 = app.clone();
    gs.on_shortcut(toggle_sc, move |_app, _sc, event| {
        if event.state() == ShortcutState::Pressed {
            crate::windows::toggle_note(&app_handle2);
        }
    }).map_err(|e| format!("register toggle: {e:?}"))?;

    Ok(())
}
```

- [ ] **Step 2: Add a temporary stub for `capture::run_capture`** so this compiles before Task 9. Create `src-tauri/src/capture.rs`:

```rust
use tauri::AppHandle;

pub fn run_capture(_app: &AppHandle) {
    // Implemented in Task 9.
}
```

- [ ] **Step 3: Wire in `lib.rs`**

Add `mod shortcuts;` and `mod capture;`. In the setup closure, after `tray::build_tray(...)`, add:

```rust
            {
                let cfg = app.state::<AppState>().config.lock().unwrap().clone();
                if let Err(e) = shortcuts::apply(app.handle(), &cfg.shortcut_capture, &cfg.shortcut_toggle) {
                    eprintln!("shortcut registration failed: {e}");
                }
            }
```

- [ ] **Step 4: Add an `apply_shortcuts` command** for the settings window (used in Task 14) — append to `commands.rs`:

```rust
#[tauri::command]
pub fn apply_shortcuts(app: tauri::AppHandle, capture: String, toggle: String) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle)
}
```
And add `commands::apply_shortcuts` to the `generate_handler!` list in `lib.rs`.

- [ ] **Step 5: Add global-shortcut permission** — in `src-tauri/capabilities/default.json` add to `permissions`:
```json
    "global-shortcut:allow-unregister-all"
```

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`
Expected: pressing `⌥⌘N` toggles the note window from anywhere (same as the tray left-click). `⌥⌘C` does nothing yet (stub). If the console logs "shortcut registration failed", the shortcut string syntax needs adjustment — try `"Alt+Super+KeyC"` / `"Alt+Super+KeyN"` and update `Config::default()` accordingly.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: global shortcuts for toggle and capture"
```

---

## Task 9: Selection capture (enigo Cmd+C + arboard) + emit event

**Files:**
- Modify: `src-tauri/src/capture.rs`

- [ ] **Step 1: Implement capture in `src-tauri/src/capture.rs`**

```rust
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{AppHandle, Emitter};

/// Backup clipboard, simulate Cmd+C, read the selection, restore clipboard,
/// then emit the formatted blockquote to the note window.
pub fn run_capture(app: &AppHandle) {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return,
    };
    let backup = clipboard.get_text().ok();

    // Clear so we can detect whether Cmd+C actually copied something new.
    let _ = clipboard.set_text(String::new());

    if simulate_copy().is_err() {
        if let Some(b) = backup { let _ = clipboard.set_text(b); }
        return;
    }

    std::thread::sleep(std::time::Duration::from_millis(120));

    let selection = clipboard.get_text().unwrap_or_default();

    // Restore the user's original clipboard.
    match backup {
        Some(b) => { let _ = clipboard.set_text(b); }
        None => { let _ = clipboard.set_text(String::new()); }
    }

    let trimmed = selection.trim();
    if trimmed.is_empty() {
        return; // no selection — do nothing
    }

    let block = crate::quote::format_quote(trimmed);
    let _ = app.emit_to("main", "quote-captured", block);
}

fn simulate_copy() -> Result<(), Box<dyn std::error::Error>> {
    let mut enigo = Enigo::new(&Settings::default())?;
    enigo.key(Key::Meta, Direction::Press)?;
    enigo.key(Key::Unicode('c'), Direction::Click)?;
    enigo.key(Key::Meta, Direction::Release)?;
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles (resolves the Task 8 stub).

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`. Grant Accessibility permission when macOS prompts (System Settings → Privacy & Security → Accessibility → enable the dev binary / Terminal). Temporarily add to `src/note/main.ts`:
```typescript
import { listen } from "@tauri-apps/api/event";
listen<string>("quote-captured", (e) => console.log("CAPTURED:\n" + e.payload));
```
Select text in Safari/Preview, press `⌥⌘C`.
Expected: the console logs the selection wrapped as `> ...`, and the clipboard still holds whatever you had copied before (verify with ⌘V somewhere). Selecting nothing and pressing `⌥⌘C` logs nothing. Remove the temporary listener after verifying (the real one lands in Task 13).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: selection capture via simulated Cmd+C with clipboard restore"
```

---

## Task 10: Note window shell — top bar + CodeMirror editor

**Files:**
- Create: `src/note/editor.ts`, `src/note/topbar.ts`
- Modify: `src/note/main.ts`, `src/styles.css`

- [ ] **Step 1: Create `src/note/editor.ts`**

```typescript
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.quote, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.list, color: "#374151" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px" },
  ".cm-content": {
    fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    lineHeight: "1.6",
    padding: "12px 16px",
  },
  "&.cm-focused": { outline: "none" },
});

export function createEditor(parent: HTMLElement, onChange: (doc: string) => void): EditorView {
  return new EditorView({
    parent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
}

export function setDoc(view: EditorView, content: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
}

export function appendToEnd(view: EditorView, text: string) {
  const end = view.state.doc.length;
  view.dispatch({ changes: { from: end, insert: text } });
}
```

- [ ] **Step 2: Create `src/note/topbar.ts`** (renders the bar; callbacks wired in Task 12)

```typescript
export interface TopbarCallbacks {
  onPickDir: () => void;
  onToggleMenu: (anchor: HTMLElement) => void;
  onNew: () => void;
}

export function renderTopbar(root: HTMLElement, cb: TopbarCallbacks) {
  root.innerHTML = `
    <div class="topbar">
      <button class="dir-name" id="dir-name" title=""><span id="dir-label">—</span></button>
      <span class="sep">/</span>
      <button class="note-name" id="note-name">
        <span id="note-label">—</span><i class="ph ph-caret-down"></i>
      </button>
      <span class="spacer"></span>
      <button class="new-btn" id="new-btn" title="新建笔记"><i class="ph ph-plus"></i></button>
    </div>
  `;
  root.querySelector<HTMLElement>("#dir-name")!.onclick = cb.onPickDir;
  const noteBtn = root.querySelector<HTMLElement>("#note-name")!;
  noteBtn.onclick = () => cb.onToggleMenu(noteBtn);
  root.querySelector<HTMLElement>("#new-btn")!.onclick = cb.onNew;
}

export function setDirLabel(name: string, fullPath: string) {
  const el = document.querySelector<HTMLElement>("#dir-label")!;
  el.textContent = name;
  document.querySelector<HTMLElement>("#dir-name")!.title = fullPath;
}

export function setNoteLabel(name: string) {
  document.querySelector<HTMLElement>("#note-label")!.textContent = name;
}
```

- [ ] **Step 3: Wire shell in `src/note/main.ts`**

```typescript
import { createEditor } from "./editor";
import { renderTopbar } from "./topbar";
import "@phosphor-icons/web/regular";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `<div id="topbar-root"></div><div id="editor-root"></div>`;

renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: () => {},
  onToggleMenu: () => {},
  onNew: () => {},
});

createEditor(document.querySelector("#editor-root")!, () => {});
```

- [ ] **Step 4: Add styles to `src/styles.css`**

```css
#app { display: flex; flex-direction: column; height: 100%; }
.topbar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,0.08);
  font-size: 13px; -webkit-user-select: none; user-select: none;
}
.topbar button {
  border: none; background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px; border-radius: 6px; color: #374151; font-size: 13px;
}
.topbar button:hover { background: rgba(0,0,0,0.06); }
.topbar .sep { color: #9ca3af; }
.topbar .spacer { flex: 1; }
#editor-root { flex: 1; overflow: auto; }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #e5e5e5; }
  .topbar { border-color: rgba(255,255,255,0.1); }
  .topbar button { color: #d1d5db; }
  .topbar button:hover { background: rgba(255,255,255,0.08); }
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run tauri dev`, toggle the window (`⌥⌘N`).
Expected: top bar shows `— / — [▾] [+]` with Phosphor caret/plus icons (not emoji); editor area below is editable and line-wraps. Follows system light/dark.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: note window shell with topbar and CodeMirror editor"
```

---

## Task 11: Note state — load config, list, autosave

**Files:**
- Create: `src/note/notes-state.ts`
- Modify: `src/note/main.ts`

- [ ] **Step 1: Create `src/note/notes-state.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface NoteEntry { name: string; path: string; }
export interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  font_size: number;
  launch_at_login: boolean;
}

export interface CurrentNote { dir: string; entry: NoteEntry; }

export async function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

export async function setWorkingDir(dir: string): Promise<void> {
  await invoke("set_working_dir", { dir });
}

export async function listNotes(dir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_notes", { dir });
}

export async function readNote(path: string): Promise<string> {
  return invoke<string>("read_note", { path });
}

export async function createNote(dir: string): Promise<NoteEntry> {
  return invoke<NoteEntry>("create_note", { dir });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSave(path: string, content: string) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    invoke("write_note", { path, content }).catch((e) => console.error("save failed", e));
  }, 500);
}

/** Pick the directory to open on launch; fall back to ~/FloatNote and create it. */
export async function resolveStartDir(cfg: Config): Promise<string> {
  if (cfg.working_dir) return cfg.working_dir;
  const { homeDir } = await import("@tauri-apps/api/path");
  const dir = `${await homeDir()}/FloatNote`;
  await setWorkingDir(dir);
  return dir;
}
```
Add `"@tauri-apps/api"` path permission is part of core; no extra capability needed for `path`.

- [ ] **Step 2: Wire load-on-start in `src/note/main.ts`** (replace its body)

```typescript
import { createEditor, setDoc } from "./editor";
import { renderTopbar, setDirLabel, setNoteLabel } from "./topbar";
import {
  getConfig, listNotes, readNote, createNote, scheduleSave, resolveStartDir,
  type CurrentNote,
} from "./notes-state";
import "@phosphor-icons/web/regular";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `<div id="topbar-root"></div><div id="editor-root"></div>`;

let current: CurrentNote | null = null;

const editor = createEditor(document.querySelector("#editor-root")!, (doc) => {
  if (current) scheduleSave(current.entry.path, doc);
});

renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: () => {},   // Task 12
  onToggleMenu: () => {}, // Task 12
  onNew: () => {},        // Task 12
});

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

async function openNote(dir: string, entry: { name: string; path: string }) {
  current = { dir, entry };
  setDirLabel(basename(dir), dir);
  setNoteLabel(entry.name);
  setDoc(editor, await readNote(entry.path));
}

async function init() {
  const cfg = await getConfig();
  const dir = await resolveStartDir(cfg);
  setDirLabel(basename(dir), dir);
  let notes = await listNotes(dir);
  const entry = notes[0] ?? (await createNote(dir));
  await openNote(dir, entry);
}

init();

export { openNote, current };
```
Note: `current` is a binding, not reactive — Task 12 will switch to a small accessor. For now expose via the module-level `let`.

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`, toggle window.
Expected: `~/FloatNote` is created; top bar shows `FloatNote / <timestamp>`; editing the note and waiting ~0.5s writes the file (verify with `cat "~/FloatNote/<file>.md"`). Reopening the app reloads the most-recently-modified note.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: note loading, listing, and debounced autosave"
```

---

## Task 12: Directory picker, note switcher menu, new note

**Files:**
- Modify: `src/note/main.ts`, `src/styles.css`

- [ ] **Step 1: Refactor `main.ts` to hold mutable state and wire the three callbacks**

Replace the `renderTopbar(...)` call and the trailing `export` with:

```typescript
import { open } from "@tauri-apps/plugin-dialog";
import { setWorkingDir } from "./notes-state";

let menuEl: HTMLElement | null = null;

function closeMenu() { menuEl?.remove(); menuEl = null; }

async function showSwitcher(anchor: HTMLElement) {
  if (menuEl) { closeMenu(); return; }
  if (!current) return;
  const notes = await listNotes(current.dir);
  menuEl = document.createElement("div");
  menuEl.className = "switch-menu";
  const rect = anchor.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;
  for (const n of notes) {
    const item = document.createElement("button");
    item.className = "switch-item";
    item.textContent = n.name;
    if (current && n.path === current.entry.path) item.classList.add("active");
    item.onclick = async () => { closeMenu(); await openNote(current!.dir, n); };
    menuEl.appendChild(item);
  }
  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

async function pickDir() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await setWorkingDir(picked);
  const notes = await listNotes(picked);
  const entry = notes[0] ?? (await createNote(picked));
  await openNote(picked, entry);
}

async function newNote() {
  if (!current) return;
  const entry = await createNote(current.dir);
  await openNote(current.dir, entry);
  editor.focus();
}

renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: pickDir,
  onToggleMenu: (anchor) => { showSwitcher(anchor); },
  onNew: newNote,
});
```
(Remove the now-duplicate `renderTopbar` call and the `export { openNote, current }` line from Task 11.)

- [ ] **Step 2: Add menu styles to `src/styles.css`**

```css
.switch-menu {
  position: fixed; min-width: 160px; max-height: 280px; overflow: auto;
  background: #fff; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18); padding: 4px; z-index: 100;
}
.switch-item {
  display: block; width: 100%; text-align: left; border: none; background: transparent;
  padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;
}
.switch-item:hover { background: rgba(0,0,0,0.06); }
.switch-item.active { font-weight: 600; }
@media (prefers-color-scheme: dark) {
  .switch-menu { background: #2a2a2a; border-color: rgba(255,255,255,0.12); }
  .switch-item { color: #d1d5db; }
  .switch-item:hover { background: rgba(255,255,255,0.08); }
}
```

- [ ] **Step 3: Add path permission** — confirm `core:default` covers `path` APIs (it does in Tauri v2). No capability change needed.

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`.
Expected:
- Clicking the directory name opens a native folder picker; choosing a folder reloads the list and opens a note in it (creating one if empty).
- Clicking the note name (caret) opens a dropdown of `.md` files in the current dir; clicking one loads it; the active note is bold.
- The `+` button creates a new timestamped note and focuses the editor.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: directory picker, note switcher, new note"
```

---

## Task 13: Receive capture event → append quote (TDD pure fn + wiring)

**Files:**
- Create: `src/note/append.ts`, `src/note/append.test.ts`
- Modify: `src/note/main.ts`

- [ ] **Step 1: Write failing test** — create `src/note/append.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAppendInsert } from "./append";

describe("buildAppendInsert", () => {
  it("returns the block alone when the doc is empty", () => {
    expect(buildAppendInsert("", "> q")).toBe("> q");
  });
  it("returns the block alone when the doc is only whitespace", () => {
    expect(buildAppendInsert("   \n", "> q")).toBe("> q");
  });
  it("prefixes two newlines when the doc has content", () => {
    expect(buildAppendInsert("hello", "> q")).toBe("\n\n> q");
  });
  it("does not add extra blank lines when the doc already ends with a newline", () => {
    expect(buildAppendInsert("hello\n", "> q")).toBe("\n> q");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildAppendInsert` not found.

- [ ] **Step 3: Implement** — create `src/note/append.ts`:

```typescript
/**
 * Compute the text to insert at the end of `doc` so that `block` is separated
 * from existing content by exactly one blank line.
 */
export function buildAppendInsert(doc: string, block: string): string {
  if (doc.trim() === "") return block;
  const trailingNewlines = doc.length - doc.replace(/\n+$/, "").length;
  const needed = Math.max(0, 2 - trailingNewlines);
  return "\n".repeat(needed) + block;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the capture listener in `src/note/main.ts`** — add near the bottom of the file (after `init()`):

```typescript
import { listen } from "@tauri-apps/api/event";
import { appendToEnd } from "./editor";
import { buildAppendInsert } from "./append";

listen<string>("quote-captured", (e) => {
  const insert = buildAppendInsert(editor.state.doc.toString(), e.payload);
  appendToEnd(editor, insert);
  // appendToEnd triggers the updateListener → debounced autosave fires.
});
```

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`. With the note window hidden, select text in another app and press `⌥⌘C`.
Expected: the quote is appended to the current note (toggle the window to see it), the window did NOT steal focus, and the file on disk gets the blockquote after ~0.5s. Capturing multiple times stacks blockquotes separated by one blank line.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: append captured quote to current note"
```

---

## Task 14: Settings window

**Files:**
- Modify: `src/settings/main.ts`, `src/styles.css`

- [ ] **Step 1: Add a `set_config` command** — append to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn set_config(state: State<AppState>, new_config: Config) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    *cfg = new_config;
    crate::config::save(&state.config_path, &cfg).map_err(|e| e.to_string())
}
```
Add `commands::set_config` to the `generate_handler!` list in `lib.rs`.

- [ ] **Step 2: Implement `src/settings/main.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  font_size: number;
  launch_at_login: boolean;
}

const app = document.querySelector<HTMLElement>("#app")!;

async function render() {
  const cfg = await invoke<Config>("get_config");
  app.innerHTML = `
    <div class="settings">
      <label>划线引用快捷键
        <input id="capture" value="${cfg.shortcut_capture}" />
      </label>
      <label>显示/隐藏快捷键
        <input id="toggle" value="${cfg.shortcut_toggle}" />
      </label>
      <label>字体大小
        <input id="font" type="number" min="10" max="28" value="${cfg.font_size}" />
      </label>
      <label class="row">
        <input id="autostart" type="checkbox" ${cfg.launch_at_login ? "checked" : ""} />
        开机自启动
      </label>
      <div id="err" class="err"></div>
      <button id="save">保存</button>
    </div>
  `;

  document.querySelector<HTMLButtonElement>("#save")!.onclick = async () => {
    const capture = (document.querySelector("#capture") as HTMLInputElement).value.trim();
    const toggle = (document.querySelector("#toggle") as HTMLInputElement).value.trim();
    const font_size = parseInt((document.querySelector("#font") as HTMLInputElement).value, 10);
    const launch_at_login = (document.querySelector("#autostart") as HTMLInputElement).checked;
    const errEl = document.querySelector<HTMLElement>("#err")!;
    errEl.textContent = "";

    try {
      await invoke("apply_shortcuts", { capture, toggle });
    } catch (e) {
      errEl.textContent = `快捷键无效或被占用：${e}`;
      return;
    }
    const newConfig: Config = { ...cfg, shortcut_capture: capture, shortcut_toggle: toggle, font_size, launch_at_login };
    await invoke("set_config", { newConfig });
    if (launch_at_login) { if (!(await isEnabled())) await enable(); }
    else { if (await isEnabled()) await disable(); }
    errEl.textContent = "已保存";
  };
}

render();
```
Add `"@tauri-apps/plugin-autostart": "^2"` to `package.json` dependencies and `npm install`.

- [ ] **Step 3: Add autostart capability** — in `src-tauri/capabilities/default.json` add to `permissions`:
```json
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
```

- [ ] **Step 4: Add settings styles to `src/styles.css`**

```css
.settings { padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.settings label { display: flex; flex-direction: column; gap: 4px; }
.settings label.row { flex-direction: row; align-items: center; gap: 8px; }
.settings input[type="text"], .settings input:not([type]), .settings input[type="number"] {
  padding: 6px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 6px; font-size: 13px;
}
.settings button { align-self: flex-start; padding: 6px 14px; border-radius: 6px; border: none;
  background: #2563eb; color: #fff; cursor: pointer; }
.settings .err { color: #b91c1c; min-height: 16px; }
```

- [ ] **Step 5: Apply font size to the editor** — in `src/note/editor.ts` change the theme `fontSize` to read a CSS variable, and in `src/note/main.ts` set it from config. In `editor.ts` theme replace `fontSize: "15px"` with `fontSize: "var(--editor-font, 15px)"`. In `main.ts` `init()` after getting `cfg` add:
```typescript
document.documentElement.style.setProperty("--editor-font", `${cfg.font_size}px`);
```

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`. Open settings from the tray menu.
Expected: form shows current config; changing the toggle shortcut and saving re-registers it live (test the new key); an invalid shortcut shows an error and does NOT persist; font size change applies to the editor on next note window load; enabling "开机自启动" registers the launch agent (verify it persists across save).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: settings window for shortcuts, font size, autostart"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** tray-only/no-Dock (Task 7), two windows (Tasks 1/7), capture shortcut + silent append + no-focus-steal (Tasks 8/9/13), toggle shortcut (Task 8), top bar dir/note/new (Tasks 10/12), system folder picker (Task 12), note switcher menu (Task 12), timestamp filenames not derived from title (Tasks 3/6), optional rename (Tasks 4/6 — command exposed; UI hook is a one-line future addition noted below), autosave (Task 11), Phosphor icons (Tasks 1/10), Vanilla TS (all), quote = pure blockquote (Task 2), settings = shortcuts/font/autostart (Task 14), error handling for no-selection/clipboard-restore (Task 9), write failure (Task 11 `scheduleSave` catch), rename conflict (Task 4), shortcut conflict (Task 14).
- **Deferred-but-specced:** click-to-rename UI. The `rename_note` command and Rust logic are implemented and tested; wiring a click handler on the note-name label is intentionally left as a small follow-up so it doesn't block v1. If desired now, add a double-click handler on `#note-name` in Task 12 that prompts for a new stem and calls `invoke("rename_note", {dir, oldName, newStem})`.
- **Type consistency:** `NoteEntry {name, path}` is identical across Rust (`notes.rs`) and TS (`notes-state.ts`); `Config` field names match the serde struct exactly; command argument names (camelCase `newConfig`, `oldName`, `newStem`) match Tauri's auto camelCase conversion of Rust snake_case params.
- **Placeholder scan:** the only intentional stub is `capture::run_capture` in Task 8, replaced fully in Task 9.

---

## Known Risks / Adjust-During-Execution

- **Shortcut string syntax**: `Shortcut::from_str("Alt+Cmd+C")` parsing is verified at runtime in Task 8 Step 6; if it errors, switch to `"Alt+Super+KeyC"` form and update `Config::default()`.
- **enigo on macOS** requires Accessibility permission; first capture attempt will silently no-op until granted. Task 9 covers granting it.
- **Phosphor import**: Task 1 links the regular-weight CSS; the `import "@phosphor-icons/web/regular"` in TS is the bundler-friendly equivalent — keep one, not both, if duplication warns.
