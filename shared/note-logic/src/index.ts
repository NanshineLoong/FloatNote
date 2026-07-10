// Public barrel. Named exports (not `export *`) so the package surface is
// exactly what the frontend (`src/`) and the sidecar (`sidecar/`) consume —
// no accidentally-public helpers. Internal-only symbols (ChangeOp, TagMap,
// writeDefsChange, serializeDefs, slugify, uniqueSlug) remain exported from
// their own modules for the co-located test suites, but are not re-exported
// here since neither consumer references them.
export {
  type BlockRange,
  blockRanges,
  moveBlockChanges,
  removeBlockChanges,
  applyChange,
  applyChanges,
} from "./blocks/ranges.js";
export {
  type TagDef,
  parseDefs,
  isDefsLine,
  buildMarker,
  stripTagMarker,
  countMarkers,
  blockTagId,
  blockTagIds,
  setBlockTagChange,
  addTagDefChange,
  addTagAndSetBlockChanges,
  patchTagDefChange,
  deleteTagChanges,
  isTagColorTaken,
} from "./tags/model.js";
export { type Swatch, PALETTE, freeColors } from "./tags/palette.js";
