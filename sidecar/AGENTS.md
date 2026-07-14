# sidecar — AI agent sidecar

Separate Node process spawned by the Rust backend (`src-tauri/src/agent.rs` and
its `agent/` submodules)
to run the Pi coding-agent with note-editing tools. Talks JSONL over stdio.
Entry: `src/main.ts`.

## Module map

- `main.ts` — stdio loop: decodes `HostToSidecar`, dispatches to `AgentRunner`,
  encodes `SidecarToHost` replies, including correlated configure results.
- `configuration-gate.ts` — serializes provider configuration changes and lets
  new/open session commands await their completion without blocking prompts,
  tool callbacks, or cancellation.
- `agent.ts` — compatibility barrel. `runner.ts` owns session lifecycle,
  `model.ts` owns fixed-provider resolution and automatic thinking, and `event-translate.ts` owns Pi→protocol
  translation.
- `protocol.ts` — `HostToSidecar`/`SidecarToHost` union types + line
  codec (`encodeLine`/`createLineDecoder`). `title` variant is declared but
  not emitted by the sidecar (kept intentionally for now).
- `note-tools.ts` — the note/project tools (`read_note`/`list_notes`/`list_tags`/
  `edit_note`/`write_note`/`create_note`/`set_tag`/`tag_create`/`tag_update`/
  `tag_delete`/`read_skill`). Tag tools
  reject non-`inbox` targets explicitly. Imports `applyChange`/`applyChanges`/
  `countMarkers`/`freeColors` from `@floatnote/note-logic` and
  `replaceOnce`/`findBlockByAnchor` from `./matching`.
- `matching.ts` — `replaceOnce`/`findBlockByAnchor` (migrated from shared;
  sidecar-only). Uses shared `blockRanges`/`stripTagMarker`.
- `skills.ts` — skill directory loading + `formatSkillsForSystemPrompt`.
- `tutor-prompt.ts` — `TUTOR_SYSTEM_PROMPT`.
- `web-tools.ts` — bounded public-web search/fetch tools with redirect-aware
  SSRF checks and untrusted-content wrappers.

Build: `npm run build` (tsc), `npm run bundle` (single ESM runtime bundle),
and `npm run prepare:tauri` (stage release resource + Node runtime). Tests:
`npm test`; release smoke: `npm run smoke`.
