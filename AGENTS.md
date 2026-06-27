# Repository Guidelines

## Project Structure & Module Organization

FloatNote is a Tauri 2 desktop app with a Vanilla TypeScript/Vite frontend.

- `src/` contains frontend code. Note-window modules live in `src/note/`; settings UI code lives in `src/settings/`; shared styles are in `src/styles.css`.
- `src-tauri/` contains the Rust backend, Tauri commands, tray/window wiring, shortcuts, note file handling, and app configuration. `src-tauri/src/notes.rs` is the key module for listing project spaces and reading/writing note files.
- A **project space** is a subfolder inside the working directory. Each project space holds up to three kinds of Markdown files: `_inbox.md` (block-style drafts), `_tasks.md` (checklist), and one or more **piece** files (any `.md` without a `_` prefix, defaulting to `piece.md`). The `_` prefix is the sole convention distinguishing system files from pieces — no other metadata is used. Loose `.md` files at the working-directory root are legacy flat notes and co-exist with project spaces.
- `index.html` and `settings.html` are the two Vite entry pages configured by `vite.config.ts`.
- `docs/` stores design and planning notes.
- `dist/` and `src-tauri/target/` are generated build artifacts; avoid editing them by hand.

## Build, Test, and Development Commands

- `npm run dev` starts the Vite frontend at the dev URL used by Tauri.
- `npm run tauri dev` runs the full desktop app in development mode.
- `npm run build` type-checks TypeScript with `tsc` and builds the frontend bundle.
- `npm test` runs frontend unit tests with Vitest.
- `npm run tauri build` creates the packaged desktop app.

Run commands from the repository root unless a Tauri/Rust command specifically requires `src-tauri/`.

## Coding Style & Naming Conventions

Use TypeScript ES modules with explicit imports and focused modules. Existing code uses two-space indentation, double quotes, semicolons, and camelCase function names such as `buildAppendInsert`. Keep DOM/window logic near the related entry module.

Rust code uses `rustfmt`, snake_case module and function names, and Tauri commands in `src-tauri/src/commands.rs`. Keep command payloads serializable with `serde`. When adding project-space operations, extend `notes.rs` rather than adding ad-hoc file logic in `commands.rs`.

## Cross-Platform & Documentation

FloatNote ships on both Windows and macOS, so develop with both targets in mind. Avoid platform-specific assumptions: handle path separators and line endings portably, guard OS-specific APIs (tray, global shortcuts, accessibility, window decorations) behind capability or platform checks, and verify any behavior that differs between the two before relying on it. When a change touches platform-sensitive areas, note the platform impact and, where feasible, exercise the flow on both.

When you are unsure about a Tauri, plugin, or other library API — or need to confirm current behavior, configuration, or migration details — use Context7 to pull the official, up-to-date documentation instead of relying on memory. Prefer this over guesswork whenever an API's exact signature, capability, or version-specific behavior matters.

## Testing Guidelines

Frontend tests use Vitest and are named `*.test.ts` next to the code they cover, for example `src/note/append.test.ts`. Prefer focused tests for pure helpers and state transitions. Run `npm test` before submitting TypeScript behavior changes.

There is no dedicated Rust test suite yet. For backend changes, at minimum run `cargo check` from `src-tauri/` and exercise the affected Tauri flow with `npm run tauri dev`.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, often with a conventional prefix, such as `feat: implement FloatNote v1`. Keep subjects concise and describe the user-visible change.

Pull requests should include a short summary, test results, and screenshots or screen recordings for UI changes. Link related issues or docs when applicable, and call out any configuration, shortcut, or filesystem behavior changes.

## Security & Configuration Tips

FloatNote reads and writes local Markdown files through Tauri commands. Treat file paths from the frontend carefully, keep permissions scoped in `src-tauri/capabilities/default.json`, and avoid committing machine-specific config or generated app data.
