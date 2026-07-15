import type { TagDef } from "../tags/model";

export interface TextRange {
  from: number;
  to: number;
}

export interface TextAnnotation extends TextRange {
  id: string;
  tagId: string;
}

export interface QuoteSourceMetadata {
  cardFrom: number;
  bundleId: string;
}

export interface InboxMetadata {
  tags: TagDef[];
  annotations: TextAnnotation[];
  quoteSources: QuoteSourceMetadata[];
}

export type InboxMetadataWarningCode =
  | "malformed-metadata"
  | "orphan-marker"
  | "duplicate-marker"
  | "unknown-tag"
  | "invalid-range";

export interface InboxMetadataWarning {
  code: InboxMetadataWarningCode;
  message: string;
  offset?: number;
}

export interface DecodedInbox {
  markdown: string;
  metadata: InboxMetadata;
  warnings: InboxMetadataWarning[];
}

export interface TextChange extends TextRange {
  insert: string;
}
