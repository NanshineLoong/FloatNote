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
- `workspace/` — projected Inbox reads, bounded search, constrained path policy,
  mutation preparation, and the one-use mutation coordinator. Inbox reads expose
  clean Markdown plus read-only tag/source context; edit offsets share that clean
  coordinate space and map v2 annotations exactly once.
- `extensions/` — trusted Pi inline extensions. `ls/read/find/grep/edit/write`
  operate on existing FloatNote notes, `create_piece(title, content)` creates a
  root-level piece from a natural title, tag tools are Inbox-only, and
  the `tool_call` hook performs review before mutation tool execution.
- `skills.ts` — immutable Skill registry snapshots and capability-scoped Skill
  resource resolution. Pi ResourceLoader owns native `<available_skills>` and
  `/skill:name`; FloatNote does not concatenate Skill text into its base prompt.
- `tutor-prompt.ts` — the thin `TUTOR_SYSTEM_PROMPT` kernel; it contains no tool
  list or Skill catalog.
- `web-tools.ts` — bounded public-web search/fetch tools with redirect-aware
  SSRF checks and untrusted-content wrappers.

Build: `npm run build` (tsc), `npm run bundle` (single ESM runtime bundle),
and `npm run prepare:tauri` (stage release resource + Node runtime). Tests:
`npm test`; release smoke: `npm run smoke`.

All local mutation tools use `tool_call → prepare → review → lease → execute/commit`.
`write` is rewrite-only; creation is a distinct create-only `create_piece`
operation so model-facing intent and host enforcement stay aligned.
The sidecar never writes note files and never receives a lease in model-visible
tool arguments. Old Agent sessions using retired tool names are unsupported.
