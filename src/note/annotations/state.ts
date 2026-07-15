import { invertedEffects } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  mapAnnotations,
  mapQuoteSources,
  type InboxMetadata,
  type QuoteSourceMetadata,
  type TextChange,
} from "@floatnote/note-logic";

export const EMPTY_INBOX_METADATA: InboxMetadata = {
  tags: [],
  annotations: [],
  quoteSources: [],
};

export const replaceInboxMetadata = StateEffect.define<InboxMetadata>();
export const addQuoteSource = StateEffect.define<QuoteSourceMetadata>();

function cloneMetadata(metadata: InboxMetadata): InboxMetadata {
  return {
    tags: metadata.tags.map((tag) => ({ ...tag })),
    annotations: metadata.annotations.map((annotation) => ({ ...annotation })),
    quoteSources: metadata.quoteSources.map((source) => ({ ...source })),
  };
}

function transactionChanges(tr: Transaction): TextChange[] {
  const changes: TextChange[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return changes;
}

const inboxMetadataField = StateField.define<InboxMetadata>({
  create: () => cloneMetadata(EMPTY_INBOX_METADATA),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      const changes = transactionChanges(tr);
      next = {
        tags: value.tags,
        annotations: mapAnnotations(value.annotations, changes),
        quoteSources: mapQuoteSources(
          tr.startState.doc.toString(),
          tr.newDoc.toString(),
          value.quoteSources,
          changes,
        ),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(replaceInboxMetadata)) next = cloneMetadata(effect.value);
      if (effect.is(addQuoteSource)) {
        next = { ...next, quoteSources: [...next.quoteSources, { ...effect.value }] };
      }
    }
    return next;
  },
});

export function inboxMetadata(state: EditorState): InboxMetadata {
  return state.field(inboxMetadataField, false) ?? EMPTY_INBOX_METADATA;
}

export function inboxMetadataExtension(): Extension[] {
  return [
    inboxMetadataField,
    invertedEffects.of((tr) => (
      tr.effects.some((effect) => effect.is(replaceInboxMetadata) || effect.is(addQuoteSource))
        ? [replaceInboxMetadata.of(cloneMetadata(inboxMetadata(tr.startState)))]
        : []
    )),
  ];
}
