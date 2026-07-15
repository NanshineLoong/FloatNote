// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationAutosave } from "./autosave";
import { inboxMetadataExtension, replaceInboxMetadata } from "./state";

describe("annotationAutosave", () => {
  it("emits an encoded snapshot for a metadata-only transaction", () => {
    const snapshots: string[] = [];
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "hello",
        extensions: [
          inboxMetadataExtension(),
          annotationAutosave((snapshot) => snapshots.push(snapshot)),
        ],
      }),
    });
    view.dispatch({ effects: replaceInboxMetadata.of({
      tags: [{ id: "idea", name: "Idea", color: "#3b82f6" }],
      annotations: [{ id: "a", tagId: "idea", from: 0, to: 5 }],
      quoteSources: [],
    }) });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toContain("floatnote:ann:v2");
    view.destroy();
  });
});
