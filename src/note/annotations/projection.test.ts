// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inboxMetadataExtension, replaceInboxMetadata } from "./state";
import { mountAnnotationProjection, renderProjectionSegments } from "./projection";

describe("renderProjectionSegments", () => {
  it("renders unrelated contexts as separate focusable items without tag names", () => {
    const root = document.createElement("div");
    renderProjectionSegments(root, "alpha beta\n\ngamma delta", [
      { from: 0, to: 10, matches: [{ from: 6, to: 10 }] },
      { from: 12, to: 23, matches: [{ from: 12, to: 17 }] },
    ]);
    const items = root.querySelectorAll(".annotation-projection-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("alpha beta");
    expect(items[1].textContent).toBe("gamma delta");
    expect(items[0].getAttribute("tabindex")).toBe("0");
  });
});

describe("mountAnnotationProjection", () => {
  it("replaces the whole editor area and navigates back on double click", () => {
    const editorRoot = document.createElement("div");
    const projectionRoot = document.createElement("div");
    document.body.append(editorRoot, projectionRoot);
    const view = new EditorView({
      parent: editorRoot,
      state: EditorState.create({ doc: "alpha beta", extensions: inboxMetadataExtension() }),
    });
    view.dispatch({ effects: replaceInboxMetadata.of({
      tags: [{ id: "idea", name: "Idea", color: "#3b82f6" }],
      annotations: [{ id: "a", tagId: "idea", from: 6, to: 10 }],
      quoteSources: [],
    }) });
    let handle: ReturnType<typeof mountAnnotationProjection>;
    handle = mountAnnotationProjection(projectionRoot, view, () => handle.setActive(null));
    handle.setActive("idea");
    expect(editorRoot.hidden).toBe(true);
    const item = projectionRoot.querySelector<HTMLElement>(".annotation-projection-item")!;
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editorRoot.hidden).toBe(true);
    item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editorRoot.hidden).toBe(false);
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 10 });
    view.destroy();
    editorRoot.remove();
    projectionRoot.remove();
  });
});
