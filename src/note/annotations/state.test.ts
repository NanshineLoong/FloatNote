import { describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import type { InboxMetadata } from "@floatnote/note-logic";
import {
  inboxMetadata,
  inboxMetadataExtension,
  replaceInboxMetadata,
} from "./state";

const metadata: InboxMetadata = {
  tags: [{ id: "idea", name: "Idea", color: "#3b82f6" }],
  annotations: [{ id: "a", tagId: "idea", from: 2, to: 5 }],
  quoteSources: [],
};

function configured(doc = "abcdef") {
  return EditorState.create({ doc, extensions: [history(), inboxMetadataExtension()] });
}

describe("Inbox metadata StateField", () => {
  it("maps ranges through document edits with outside boundary affinity", () => {
    let state = configured();
    state = state.update({
      effects: replaceInboxMetadata.of(metadata),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    state = state.update({ changes: { from: 2, insert: "X" } }).state;
    expect(inboxMetadata(state).annotations[0]).toMatchObject({ from: 3, to: 6 });
  });

  it("undoes a metadata-only action as one history event", () => {
    let state = configured();
    state = state.update({ effects: replaceInboxMetadata.of(metadata) }).state;
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    expect(undo({ state, dispatch })).toBe(true);
    expect(inboxMetadata(state)).toEqual({ tags: [], annotations: [], quoteSources: [] });
  });

  it("keeps quote identity anchored to the title through title replacement", () => {
    let state = configured("> [!quote] Old\n> body");
    state = state.update({ effects: replaceInboxMetadata.of({
      tags: [], annotations: [], quoteSources: [{ cardFrom: 0, bundleId: "com.app" }],
    }) }).state;
    state = state.update({ changes: { from: 0, to: 14, insert: "> [!quote] New" } }).state;
    expect(inboxMetadata(state).quoteSources).toEqual([{ cardFrom: 0, bundleId: "com.app" }]);
  });
});
