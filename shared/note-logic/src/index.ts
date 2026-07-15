// Public barrel. Named exports keep the frontend and sidecar on one codec and
// one set of annotation transformations.
export { type TagDef, MAX_TAG_NAME_LENGTH, isValidTagName } from "./tags/model.js";
export { type Swatch, PALETTE, freeColors } from "./tags/palette.js";
export {
  type TextRange,
  type TextAnnotation,
  type QuoteSourceMetadata,
  type InboxMetadata,
  type InboxMetadataWarning,
  type InboxMetadataWarningCode,
  type DecodedInbox,
  type TextChange,
} from "./annotations/types.js";
export { decodeInbox, encodeInbox } from "./annotations/codec.js";
export {
  addAnnotationRanges,
  removeAnnotationRanges,
  mapAnnotations,
  mapPoint,
} from "./annotations/ranges.js";
export { mapQuoteSources } from "./annotations/quotes.js";
export { findExactText, type ExactTextQuery, type ExactTextMatch } from "./annotations/matching.js";
export {
  markdownContexts,
  eligibleSelectionRanges,
  annotationProjection,
  type MarkdownContext,
  type AnnotationProjectionSegment,
} from "./annotations/contexts.js";
