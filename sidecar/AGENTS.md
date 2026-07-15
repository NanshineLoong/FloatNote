# sidecar — AI agent sidecar

Separate Node process spawned by the Rust backend (`src-tauri/src/agent.rs` and
its `agent/` submodules)
to run the Pi coding-agent with note-editing tools. Talks JSONL over stdio.
Entry: `src/main.ts`.

## Module map

- `main.ts` — stdio loop: decodes `HostToSidecar`, dispatches to `AgentRunner`,
  encodes `SidecarToHost` replies, including correlated configure results.
- `configuration-gate.ts` — serializes provider configuration changes and lets
  new/open session commands await the initial host configuration decision and
  later changes without blocking prompts, tool callbacks, or cancellation.
- `agent.ts` — compatibility barrel. `runner.ts` owns session lifecycle,
  `model.ts` owns fixed-provider resolution and automatic thinking, and `event-translate.ts` owns Pi→protocol
  translation.
- `protocol.ts` — `HostToSidecar`/`SidecarToHost` union types + line
  codec (`encodeLine`/`createLineDecoder`). Turn `done` events carry a
  completed/cancelled/failed outcome. `title` variant is declared but
  not emitted by the sidecar (kept intentionally for now).
- `one-shot.ts` — restricted no-session/no-tool completion contexts. Only the
  `translate` task is registered; unknown tasks must fail closed.
- `tool-title.ts` — pure safe tool-title and short-error formatting shared by
  live events and session restoration; raw arguments/results never cross the
  display protocol.
- `note-tools.ts` — the note/project tools (`read_note`/`list_notes`/`list_tags`/
  `edit_note`/`write_note`/`create_note`/`tag_text`/`tag_create`/`tag_update`/
  `tag_delete`/`read_skill`). Inbox reads expose clean Markdown; edits map v2
  annotations through exact changes, and whole-document overwrite is rejected
  while annotations exist. Tag tools reject non-`inbox` targets explicitly;
  `tag_text` permission previews carry both an 80-character excerpt and the
  complete exact target text.
- `matching.ts` — sidecar-only unique string replacement; text annotation
  matching and transformations come from `@floatnote/note-logic`.
- `skills.ts` — skill directory loading + `formatSkillsForSystemPrompt`.
- `tutor-prompt.ts` — `TUTOR_SYSTEM_PROMPT`.
- `web-tools.ts` — bounded public-web search/fetch tools with redirect-aware
  SSRF checks and untrusted-content wrappers.

Build: `npm run build` (tsc), `npm run bundle` (single ESM runtime bundle),
and `npm run prepare:tauri` (stage release resource + Node runtime). Tests:
`npm test`; release smoke: `npm run smoke`.
