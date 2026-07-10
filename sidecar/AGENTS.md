# sidecar — AI agent sidecar

Separate Node process spawned by the Rust backend (`src-tauri/src/agent.rs`)
to run the Pi coding-agent with note-editing tools. Talks JSONL over stdio.
Entry: `src/main.ts`.

## Module map

- `main.ts` — stdio loop: decodes `HostToSidecar`, dispatches to `AgentRunner`,
  encodes `SidecarToHost` replies.
- `agent.ts` — `AgentRunner` (session lifecycle, `prompt`/`cancel` scoped per
  requestId→conversationId, `getNoteText` rejects on `found=false`), model
  builder (`buildAgentModel`), event translation (`translateEvent`),
  `defaultCreateSession`. (Candidate split: model / event-translate / runner.)
- `protocol.ts` — `HostToSidecar`/`SidecarToHost` union types + line
  codec (`encodeLine`/`createLineDecoder`). `title` variant is declared but
  not emitted by the sidecar (kept intentionally for now).
- `note-tools.ts` — the 8 agent tools (`read_note`/`list_tags`/`edit_note`/
  `write_note`/`set_tag`/`tag_create`/`tag_delete`/`read_skill`). Tag tools
  reject non-`inbox` targets explicitly. Imports `applyChange`/`applyChanges`/
  `countMarkers`/`freeColors` from `@floatnote/note-logic` and
  `replaceOnce`/`findBlockByAnchor` from `./matching`.
- `matching.ts` — `replaceOnce`/`findBlockByAnchor` (migrated from shared;
  sidecar-only). Uses shared `blockRanges`/`stripTagMarker`.
- `skills.ts` — skill directory loading + `formatSkillsForSystemPrompt`.
- `tutor-prompt.ts` — `TUTOR_SYSTEM_PROMPT`.

Build: `npm run build` (tsc). Tests: `npm test` (vitest).
