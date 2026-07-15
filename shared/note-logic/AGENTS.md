# shared/note-logic — shared pure note logic

Workspace package `@floatnote/note-logic`, consumed by the frontend
(`src/`) and the sidecar (`sidecar/`). Pure TypeScript, no DOM, no I/O.
Barrel: `src/index.ts`.

## Modules

- `annotations/codec.ts` — v2 disk metadata ↔ clean Inbox Markdown codec,
  including paired text markers and quote-source metadata.
- `annotations/ranges.ts` — same-tag union/subtraction and text-change mapping.
- `annotations/contexts.ts` — Lezer Markdown eligible-context segmentation and
  read-only projection grouping; code, URL, image, and syntax ranges are excluded.
- `annotations/matching.ts` — exact text plus prefix/suffix disambiguation.
- `tags/model.ts` — the shared `TagDef` DTO only; persistence belongs to the codec.
- `tags/palette.ts` — canonical tag color `PALETTE` (8 swatches) +
  `freeColors(used)`. Shared so the agent's tag tools see the same colors
  the user sees in the picker.
- `tasks.ts` was migrated to `src/note/tasks.ts` (frontend-only); `matching.ts`
  to `sidecar/src/matching.ts` (sidecar-only). This package now holds only
  logic used by BOTH consumers. The former Inbox top-level block parser and
  block-scoped tag APIs were removed.

Tests: `*.test.ts` next to each module. The only runtime dependency is the
pure `@lezer/markdown` parser; there is no DOM, Node I/O, or Tauri dependency.
