# Local CI and Release Preflight Design

## Goal

Give developers and coding agents two cross-platform commands that reproduce the deterministic validation portions of GitHub Actions before changes are pushed:

- `npm run ci:local` for the standard JavaScript/TypeScript CI gate.
- `npm run release:check -- --tag vX.Y.Z` for release-specific validation, sidecar staging, and Rust checks.

The commands must catch an invalid `package-lock.json` by starting with `npm ci`. They must not create tags, GitHub releases, or upload assets.

## Scope

`ci:local` runs, in order:

1. `npm ci`
2. `npm run version:check`
3. `npm run check`

`release:check` requires a `--tag vX.Y.Z` argument and runs, in order:

1. `npm ci`
2. `npm run version:check -- --tag vX.Y.Z`
3. `npm run check`
4. `npm run package:sidecar`
5. `cargo test --lib` in `src-tauri/`
6. `cargo check` in `src-tauri/`
7. `cargo check --release` in `src-tauri/`

The release preflight deliberately excludes `tauri build --bundles dmg`. GitHub Actions remains authoritative for native Apple Silicon and Intel DMG builds, runner architecture, draft-release creation, permissions, and asset upload. A developer may still run a local Tauri bundle build when changing packaging-sensitive code.

## Architecture

Create one focused Node ES module under `scripts/` to parse the mode and optional tag, build the ordered command list, and execute each child process synchronously with inherited stdio. It selects `npm.cmd` through the Windows command shell and `npm` directly elsewhere, while Cargo is invoked directly with `cwd` set to `src-tauri`.

The command-list builder is exported and side-effect free so Node's built-in test runner can verify ordering, tag validation, and platform-specific executable selection without performing installations or builds. The CLI entry point only executes when the module is launched directly.

`package.json` exposes the two public scripts. Existing GitHub workflows keep their explicit steps so their logs and platform-specific responsibilities remain clear; infrastructure tests assert that the local commands stay aligned with those workflow gates.

## Error Handling

- Missing, repeated, or malformed release arguments fail before running any command and print usage.
- A failed child command stops the sequence immediately and returns that command's nonzero exit status.
- Process-spawn errors produce a concise command-specific error and return a nonzero status.
- No command mutates Git history or GitHub state.

## Documentation and Agent Policy

- Add both commands to `AGENTS.md` and make `ci:local` the required completion gate for dependency and JavaScript/TypeScript changes.
- Require `release:check` before creating a release tag.
- Update `docs/development/testing.md` with the local CI tiers.
- Update `docs/development/release.md` with the release preflight boundary and the checks that remain GitHub-only.

## Testing

Use Node's built-in test runner through the existing `npm run test:infra` glob. Tests cover:

- Exact `ci:local` command order.
- Exact `release:check` command order and Rust working directory.
- Windows `npm.cmd` selection.
- Required and valid release tag parsing.
- Workflow/package-script alignment.

Verification runs the new focused test first, then `npm run ci:local`. Because `ci:local` begins with `npm ci`, this directly exercises the lockfile consistency failure that motivated the change.
