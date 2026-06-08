# Repository Guidelines

## Project Structure & Module Organization

FloatNote is a Tauri 2 desktop app with a Vanilla TypeScript/Vite frontend.

- `src/` contains frontend code. Note-window modules live in `src/note/`; settings UI code lives in `src/settings/`; shared styles are in `src/styles.css`.
- `src-tauri/` contains the Rust backend, Tauri commands, tray/window wiring, shortcuts, note file handling, and app configuration.
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

Rust code uses `rustfmt`, snake_case module and function names, and Tauri commands in `src-tauri/src/commands.rs`. Keep command payloads serializable with `serde`.

## Testing Guidelines

Frontend tests use Vitest and are named `*.test.ts` next to the code they cover, for example `src/note/append.test.ts`. Prefer focused tests for pure helpers and state transitions. Run `npm test` before submitting TypeScript behavior changes.

There is no dedicated Rust test suite yet. For backend changes, at minimum run `cargo check` from `src-tauri/` and exercise the affected Tauri flow with `npm run tauri dev`.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, often with a conventional prefix, such as `feat: implement FloatNote v1`. Keep subjects concise and describe the user-visible change.

Pull requests should include a short summary, test results, and screenshots or screen recordings for UI changes. Link related issues or docs when applicable, and call out any configuration, shortcut, or filesystem behavior changes.

## Security & Configuration Tips

FloatNote reads and writes local Markdown files through Tauri commands. Treat file paths from the frontend carefully, keep permissions scoped in `src-tauri/capabilities/default.json`, and avoid committing machine-specific config or generated app data.
