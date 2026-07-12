# Settings Modernization Design

## Goal

Replace FloatNote's single long settings form with a compact, modern, autosaving
settings experience. The implementation keeps all controls functional on macOS
and Windows, removes obsolete outline defaults, and turns the existing skill
runtime into user-manageable configuration.

## Window and visual design

- The settings webview has no in-content title and no native window title bar.
- The page is a compact two-column desktop layout: a narrow left navigation and
  a content panel. Tabs are **General**, **AI Tutor**, and **Shortcuts**.
- The navigation uses small icons, a low-contrast selected surface, and no card
  chrome. Content sections use concise labels, thin separators, consistent
  controls, and accessible hover/focus states. The visual direction references
  CodePilot's quiet sidebar hierarchy without copying its components.
- Settings write immediately after a validated change. A small, transient
  status message is reserved for errors; there is no Save button or success
  toast for every change.

## General tab

### Appearance

- Add `theme` to persisted app configuration with `system`, `light`, and
  `dark` values; default is `system`.
- Apply the resolved theme immediately in every app webview (note, settings,
  history, and popup), and on system-theme changes when `system` is selected.
- Present the selector as a compact segmented choice or select control labelled
  "Appearance".

### Global font size

- Keep the existing `font_size` configuration key but make it the global UI
  base size, not only the note editor size.
- Show one compact row with a minus button, current pixel value, and plus
  button. Use a bounded integer range that is consistent with the existing
  editor-size behavior.
- Persist and apply the change immediately. Display the concise hint
  `⌘ + / ⌘ − · Windows: Ctrl + / Ctrl −` beneath the row.

### Launch at login

- Retain the existing Tauri autostart integration. Toggle it immediately with
  the plugin and persist the result only after the plugin operation succeeds.
- If the plugin rejects the request, restore the control to the persisted value
  and show an inline error.

### Removed setting

- Remove `piece_outline_default` from the settings UI, TypeScript config DTO,
  Rust `Config`, defaults, tests, and note-window startup behavior. Existing
  JSON values remain harmlessly ignored by serde.

## AI Tutor tab

### Provider profiles

- Do not show an empty or "not configured" provider choice; a valid provider is
  selected by default for new configurations.
- Remove Google. Expose a deliberately small set of provider profiles:
  Anthropic, OpenAI, DeepSeek, DashScope (Qwen), MiniMax, Moonshot/Kimi, and
  Custom OpenAI-compatible.
- Anthropic, OpenAI, DeepSeek, MiniMax, and Moonshot use PI's registered model
  providers. DashScope is a profile that supplies its OpenAI-compatible
  endpoint and Qwen model presets, because PI 0.79.10 does not register
  DashScope as a native provider. Custom accepts a user endpoint and model.
- Each profile offers a model preset select plus a custom-model entry. Changing
  the provider selects a sensible default model only when the current model is
  empty or belongs to the prior profile; it does not discard user input.
- API key is always available. The endpoint field is only shown for DashScope
  and Custom. A debounced validated edit configures the running sidecar; failed
  configuration leaves the persisted form data intact and shows an inline
  connection error.

### Skills

- Fetch the current skill summaries through the existing sidecar command and
  list them with individual enabled switches.
- Persist disabled skill names in a new config field. Extend the host-to-sidecar
  skill-load message with those names; the sidecar loads the bundled and user
  roots, filters disabled names before it builds its prompt/body map, and
  refreshes immediately after a change.
- `Import Skill` accepts a `SKILL.md` file or an enclosing directory. It
  validates frontmatter (`name` and `description`), copies the skill directory
  into `~/.floatnote/skills/<name>`, rejects path traversal and duplicate names,
  then reloads sidecar skills and refreshes the list. No folder-opening action
  is included.

## Shortcuts tab

- Keep global and note-window shortcuts in their existing functional groups.
- Recording a key combination recomputes conflicts against every shortcut.
  Conflicting values display inline and are not applied or persisted.
- A non-conflicting completed recording immediately calls the existing shortcut
  registration command and then persists configuration. Registration errors
  restore the prior value and display inline.
- Remove the permanently visible Restore Defaults button. Each recorder exposes
  a compact reset affordance while it differs from its default value.
- The selection-popup mode saves independently and immediately.

## Persistence and migration

- Centralize settings-page mutation in small category-specific autosave helpers
  so browser event handlers do not construct unrelated configuration fields.
- Preserve the existing `custom` provider migration to OpenAI-compatible
  behavior. Normalize legacy empty/Google provider values to a supported
  default during settings load without showing an invalid option.
- New config fields are serde-defaulted so earlier config files remain valid.

## Testing and verification

- Add frontend unit tests for provider-profile/model selection, theme/font
  mutation helpers, shortcut autosave conflict gates, and settings source shape
  (no Save button or outline default control).
- Add Rust tests for configuration defaults/migrations, enabled-skill filtering,
  and import validation/copy behavior in a temporary FloatNote home.
- Retain sidecar skill tests and add a test proving filtered skill lists exclude
  disabled names after reload.
- Run `npm test`, `npm run build`, `npm run smoke:sidecar`, `cargo test --lib`,
  `cargo check`, and `cargo check --release`. Exercise the changed settings
  flow in Tauri on macOS; review Windows-specific autostart, titlebar, and key
  label behavior in code paths/configuration.
