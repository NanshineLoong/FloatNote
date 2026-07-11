// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, Strikethrough, TaskList } from "@lezer/markdown";
import { livePreview } from "./preview";
import { attachImageToolbar } from "./image-toolbar";

/** Mount a real EditorView with the live-preview extensions. jsdom can't
 *  faithfully simulate the CM6 mousedown→cursor teardown that the real
 *  browser preventDefault guards against, so this fixture only asserts the
 *  RENDERED widget structure — not click interactions. */
function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [Table, Strikethrough, TaskList] }),
        ...livePreview(),
        EditorView.lineWrapping,
      ],
    }),
  });
}

describe("ImgWidget structure", () => {
  it("renders figure > cm-img-wrap > img (+ optional figcaption)", () => {
    // Image on line 2; cursor stays on line 1 so the onCursorLine gate
    // doesn't fall back to source mode for the image line.
    const view = mount("text\n![](https://example.com/a.png)\n");
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement | null;
    expect(figure).toBeTruthy();
    expect(figure!.querySelector(".cm-img-wrap")).toBeTruthy();
    expect(figure!.querySelector(".cm-img-wrap > img.cm-preview-img")).toBeTruthy();
    // No caption → no figcaption in the shell.
    expect(figure!.querySelector("figcaption")).toBeNull();
  });

  it("renders a static figcaption when the image has a caption (non-active shell)", () => {
    const view = mount("text\n![图注](https://example.com/a.png)\n");
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement | null;
    expect(figure).toBeTruthy();
    const fig = figure!.querySelector("figcaption.cm-preview-figcaption");
    expect(fig).toBeTruthy();
    expect(fig!.textContent).toBe("图注");
  });

  it("keeps inline images as source instead of replacing surrounding prose", () => {
    const view = mount("intro\ntext before ![cap](https://example.com/a.png) text after\n");
    expect(view.dom.querySelector(".cm-preview-figure")).toBeNull();
    expect(view.state.doc.toString()).toContain("text before");
    view.destroy();
  });

  it("enters image Markdown source with F2 after selecting the rendered image", () => {
    const doc = "above\n![cap](https://example.com/a.png)\nbelow";
    const view = mount(doc);
    const detach = attachImageToolbar(view);
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement;
    figure.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    figure.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(figure.classList.contains("cm-img-active")).toBe(true);

    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));

    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.head).toBe(doc.indexOf("![cap]") + 2);
    expect(view.dom.querySelector(".cm-preview-figure")).toBeNull();

    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(view.dom.querySelector(".cm-preview-figure")).toBeTruthy();
    detach();
    view.destroy();
  });
});
