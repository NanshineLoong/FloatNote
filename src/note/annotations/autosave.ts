import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { encodeInbox } from "@floatnote/note-logic";
import { addQuoteSource, inboxMetadata, replaceInboxMetadata } from "./state";

export function annotationAutosave(
  save: (encodedSnapshot: string) => void,
  shouldSave: () => boolean = () => true,
): Extension {
  return EditorView.updateListener.of((update) => {
    const metadataChanged = update.transactions.some((transaction) => (
      transaction.effects.some((effect) => (
        effect.is(replaceInboxMetadata) || effect.is(addQuoteSource)
      ))
    ));
    if (!shouldSave() || (!update.docChanged && !metadataChanged)) return;
    save(encodeInbox(update.state.doc.toString(), inboxMetadata(update.state)));
  });
}
