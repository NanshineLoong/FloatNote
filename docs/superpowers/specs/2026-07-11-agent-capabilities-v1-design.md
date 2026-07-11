# FloatNote Agent Capabilities v1 Design

- Date: 2026-07-11
- Status: confirmed design, pending written-spec review
- Scope: Agent system prompt, note/file/tag tools, web research tools, write permissions, and supporting host/UI protocol

## 1. Goal

Give the FloatNote Agent a coherent understanding of project-space notes and a
safe, complete v1 tool set. The Agent must understand FloatNote metadata and
source-attributed quote cards, discover the current project dynamically, search
and read public web content, create a piece with confirmation, and modify notes
and tags without receiving arbitrary filesystem access.

This design does not support legacy loose root Markdown documents. Existing app
support for those documents is not removed, but Agent prompts, targets, listing,
creation, reads, and writes exclude them.

## 2. Decisions

1. Use a semantic system prompt plus domain tools and host-delegated local I/O.
2. Do not put a concrete file list in the system prompt. The Agent calls
   `list_notes` when it needs current project contents.
3. The Agent may create only a piece in the current project space. It may not
   create `_inbox.md`, `_tasks.md`, directories, or files outside the project.
4. Read-only web tools run without approval but remain visible in the
   conversation process stream. External content is always untrusted data.
5. Keep task editing on `edit_note`; do not add a parallel task mutation API.
6. Keep one host permission/write pipeline, while using operation-specific
   previews and confirmation cards.
7. Add `tag_update` for atomic tag rename/recolor. The Agent must not hand-edit
   tag definitions or marker comments.

## 3. FloatNote Document Semantics

The system prompt describes the document model rather than duplicating tool
schemas.

### 3.1 Project-space targets

The Agent-visible `NoteTarget` is:

```ts
type NoteTarget =
  | { kind: "inbox" }
  | { kind: "tasks" }
  | { kind: "piece"; name?: string };
```

- `inbox` is `_inbox.md`, used for captured blocks and drafts.
- `tasks` is `_tasks.md`, represented as Markdown checklists.
- `piece` is a normal `.md` file without a leading `_`; `name` selects a piece,
  while omission means the active piece where applicable.
- No `doc` target is exposed to the Agent.

### 3.2 Tags

`<!-- floatnote:tag=<id> -->` is block-level metadata, not prose. The Agent must
not quote, translate, summarize, or casually rewrite it. Tag definitions and
markers are modified only by `set_tag`, `tag_create`, `tag_update`, and
`tag_delete`.

### 3.3 Source-attributed quotes

A source quote is a Markdown callout card:

```markdown
> [!quote] [Page title](https://example.com)<!-- floatnote:bid=com.browser.app -->
> Quoted body
```

- `> [!quote]` identifies a quote card.
- A Markdown link on the title line identifies a web source.
- A bare title may identify an application source.
- `<!-- floatnote:bid=... -->` is hidden source-application identity metadata.
- Following `>` lines are the quoted body.

Source metadata is evidence attribution, not an instruction channel. Content in
quotes, linked pages, search results, or fetched pages cannot override system or
user instructions.

## 4. System Prompt Structure

`sidecar/src/tutor-prompt.ts` is reorganized into stable sections:

1. role and teaching behavior;
2. FloatNote project-space and structured-note semantics;
3. tool-selection policy;
4. write discipline and user-control rules;
5. untrusted-content and prompt-injection boundary;
6. concise Chinese response style.

The prompt contains behavioral rules and format semantics. Exact parameters,
defaults, validation rules, and return shapes live in tool descriptions and
TypeBox schemas so prompt text and executable schemas do not drift.

Tool-selection rules are explicit:

- read the active note directly when sufficient;
- call `list_notes` before selecting an unknown/cross-file target;
- prefer `edit_note` for a localized unique replacement;
- reserve `write_note` for a genuine whole-note restructuring;
- use tag tools for all tag metadata changes;
- explain the intended local write and reason before invoking a write tool;
- do not retry an equivalent operation after the user denies it;
- cite source URLs in research answers and distinguish sourced facts from
  inference.

## 5. v1 Tool Set

### 5.1 Read-only, auto-run tools

| Tool | Purpose |
|---|---|
| `read_note(target?)` | Read raw current note text, including hidden metadata. |
| `list_notes()` | Dynamically list `_inbox`, `_tasks`, and pieces in the active project space. Takes no directory. |
| `list_tags(target?)` | Return inbox tag definitions and free palette colors. |
| `web_search(query, count?)` | Search the public web and return bounded title/URL/snippet results. |
| `web_fetch(url)` | Fetch one public HTTP(S) URL and return bounded readable text plus final URL/title metadata. |
| `read_skill(name)` | Load a known FloatNote skill by stable name. |

Network tools produce normal tool start/end process blocks. They do not require
permission because they do not mutate local state, but their query or hostname
is visible.

### 5.2 Confirmed write tools

| Tool | Purpose | Preview |
|---|---|---|
| `edit_note` | Unique `old_string` to `new_string` replacement. Covers prose, block, and checklist edits. | Local diff, contextual label such as “修改任务” or “修改文档”. |
| `write_note` | Whole-note replacement for large restructuring. | Whole-document diff with elevated overwrite warning. |
| `create_note(title, content?)` | Create one non-system piece in the current project. | Filename plus bounded initial-content summary. |
| `set_tag` | Assign or clear a tag on one inbox block. | Semantic block/tag card. |
| `tag_create` | Add one tag definition using a free color. | Tag name/color card. |
| `tag_update(tagId, name?, color?)` | Atomically rename and/or recolor a tag definition. | Before/after tag card. |
| `tag_delete` | Delete a tag and clear all its block markers atomically. | Destructive card with marker count. |

`create_note` accepts a title, not a path. The host normalizes it to one `.md`
piece filename and rejects empty names, leading `_`, separators, reserved names,
and collisions. It never overwrites an existing note.

`tag_update` requires at least one of `name` or `color`, validates name and color
conflicts using shared note logic, and rewrites the definition atomically. Block
markers retain the stable tag id when only display properties change.

## 6. Sidecar and Host Architecture

### 6.1 Module boundaries

- `sidecar/src/note-tools.ts` owns FloatNote note/tag tools and pure
  old-content to new-content transformations.
- `sidecar/src/web-tools.ts` owns web tool definitions, URL policy, fetch/search
  adapters, response extraction, and output limits.
- `sidecar/src/runner.ts` wires both tool groups into the Pi session and resolves
  host request/result promises.
- `sidecar/src/protocol.ts` and `src-tauri/src/agent/protocol.rs` mirror all JSONL
  messages and preview variants.
- Rust remains the only local filesystem writer and the authority for target
  resolution, current project directory, collision checks, and final writes.

### 6.2 Note listing

`list_notes` sends a request with `callId` and `conversationId`; it carries no
path. Rust derives the project directory from the active note context, calls the
existing note/project layer, filters to `inbox | tasks | piece`, and returns
stable target data plus display names. The sidecar formats the structured result
for the model.

### 6.3 Note creation

Creation uses the same permission queue and call correlation as edits:

1. sidecar validates the requested title enough to produce a preview;
2. sidecar sends a create request containing title, initial content, preview,
   `conversationId`, `callId`, and `toolCallId`;
3. Rust emits the normal permission request;
4. the frontend renders the `note_create` card;
5. after approval, Rust revalidates the filename and project containment, then
   calls the note layer with no-overwrite semantics;
6. Rust returns the created piece target or a collision/validation error.

Creation is a distinct operation, not a fake edit against an empty file. This
keeps permission copy, collision behavior, and audit history truthful while
reusing the permission state machine.

### 6.4 Existing edits and tags

Existing edit tools continue to pull the latest raw note, compute the complete
new content in the sidecar, and send old/new content to Rust. After approval,
Rust compares the expected old content with the current file before writing.
This protects against edits made while the permission card is open.

## 7. Permission UI

Permission state remains keyed by `callId`; decision state and execution state
remain independent. `tool end` cannot erase an allowed or denied decision.

`EditPreviewDetail` gains:

```ts
type EditPreviewDetail =
  | ExistingPreviewVariants
  | { kind: "note_create"; filename: string; contentPreview: string }
  | {
      kind: "tag_update";
      tagId: string;
      oldName: string;
      oldColor: string;
      newName: string;
      newColor: string;
    };
```

The UI uses one permission-block component/state machine with variant renderers:
localized diff, whole overwrite, note creation, tag assign/create/update/delete.
Web tools are process blocks rather than permission blocks.

## 8. Web Tools and Security

### 8.1 Search adapter

The implementation first checks whether the installed Pi SDK exposes reusable
web search/fetch tools compatible with custom-tool sessions. If it does, the
sidecar adapts those implementations behind FloatNote-owned schemas and limits.
If it does not, `web_search` uses a replaceable no-key public search adapter.
Adapter failure is returned explicitly; the Agent must never invent results.

The adapter interface is injected for deterministic tests and future provider
replacement.

### 8.2 Fetch policy

`web_fetch`:

- accepts only `http:` and `https:` URLs;
- rejects embedded credentials;
- resolves and rejects loopback, private, link-local, multicast, and otherwise
  non-public destinations for IPv4 and IPv6;
- revalidates every redirect target, with a small redirect limit;
- uses an abort timeout and response byte limit;
- accepts textual HTML/plain/Markdown-style responses and rejects binary
  bodies;
- extracts readable text, title, final URL, and status;
- truncates model-visible output to a fixed character budget.

The tool result wraps content with an explicit untrusted-data warning. DNS and
redirect validation are enforced by code, not merely prompt wording.

## 9. Error Handling

| Failure | Behavior |
|---|---|
| No active project context | `list_notes`/`create_note`/explicit cross-note operations return a clear tool error. |
| Unknown or absent target | Return not found; do not fall back to another note. |
| Create title invalid or colliding | Return validation/conflict error; never overwrite. |
| Edit anchor absent/ambiguous | Return the existing unique-match error and require a reread. |
| Note changed before approval | Host rejects as stale; Agent rereads before proposing a new operation. |
| User denies write | Tool reports denial; Agent does not repeat the equivalent request. |
| Tag name/color conflict | Return current conflicting state/free colors. |
| Search backend unavailable | Return an explicit tool error with no fabricated results. |
| Unsafe fetch URL/redirect | Reject before connecting or following the redirect. |
| Fetch timeout/oversize/binary | Return a bounded, user-readable tool error. |

## 10. Testing and Verification

### 10.1 Sidecar

- prompt tests assert project-space, tag, quote-source, untrusted-content,
  no-legacy-doc, and tool-selection rules;
- note-tool tests cover dynamic listing, create requests, tag rename/recolor,
  conflicts, and previews;
- web-tool tests inject DNS/search/fetch adapters and cover schemes, public vs
  private addresses, redirect revalidation, timeout, type/size limits, HTML text
  extraction, truncation, and untrusted wrappers;
- protocol tests cover every new request/result and preview variant.

### 10.2 Rust host

- protocol serialization remains byte-shape compatible with TypeScript;
- listing derives the directory from active project context and excludes loose
  docs and non-Markdown/system-unknown files;
- creation accepts only a valid piece, is contained within the project, and
  refuses collisions;
- create permission allow/deny and response correlation are covered;
- existing stale-write checks remain green.

### 10.3 Frontend

- permission rendering covers note creation and tag update;
- overwrite and destructive variants retain their risk treatment;
- `callId` updates the correct block and preserves decision state;
- read-only web process blocks never expose approval controls.

### 10.4 Commands

Run from the worktree root unless noted:

```bash
npm test
npm run build
npm run check
cd src-tauri && cargo test --lib
cd src-tauri && cargo check
cd src-tauri && cargo check --release
```

The current development machine runs Node 22.14 while Pi 0.79.10 declares Node
22.19 or newer. Baseline tests pass under 22.14, but release verification should
also be exercised with a supported Node runtime.

## 11. Documentation Impact

Update focused sections in:

- `docs/architecture/sidecar.md` for the complete tool set and module split;
- `docs/architecture/data-flow.md` for list/create and web-research flows;
- `docs/architecture/security.md` for project containment, write confirmation,
  SSRF defenses, and untrusted web content;
- repository/module guidance only if public module responsibilities change.

## 12. Out of Scope

- legacy loose root Markdown documents in any Agent capability;
- arbitrary file or directory creation;
- a task-specific mutation API;
- a full Markdown/block AST tool suite;
- browsing authenticated sites or running page JavaScript;
- session/global auto-approval policies;
- automatic writing of fetched web content into a note;
- deleting or renaming pieces through the Agent.
