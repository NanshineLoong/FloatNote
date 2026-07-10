# shared/note-logic — shared pure note logic

Workspace package `@floatnote/note-logic`, consumed by the frontend
(`src/`) and the sidecar (`sidecar/`). Pure TypeScript, no DOM, no I/O.
Barrel: `src/index.ts`.

## Modules

- `blocks/ranges.ts` — `BlockRange`, `blockRanges`, `moveBlockChanges`/
  `removeBlockChanges`, `ChangeOp`, `applyChange`/`applyChanges` (batch
  apply, right-to-left so offsets stay valid).
- `tags/model.ts` — tag-definition parsing/serialization, per-block markers
  (`buildMarker`/`stripTagMarker`/`countMarkers`), and change ops
  (`setBlockTagChange`/`addTagDefChange`/`deleteTagChanges`), slug helpers.
- `tags/palette.ts` — canonical tag color `PALETTE` (8 swatches) +
  `freeColors(used)`. Shared so the agent's tag tools see the same colors
  the user sees in the picker.
- `tasks.ts` was migrated to `src/note/tasks.ts` (frontend-only); `matching.ts`
  to `sidecar/src/matching.ts` (sidecar-only). This package now holds only
  logic used by BOTH consumers.

Tests: `*.test.ts` next to each module. Note: the package has no
`dependencies`; `vitest/globals` types resolve via the consuming workspaces.
