// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, Strikethrough, TaskList } from "@lezer/markdown";
import { livePreview } from "./preview";
import { attachImageToolbar } from "./image-toolbar";
import { ImgWidget } from "./preview/widgets";

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
  it("renders a block figure with a tight image content group", () => {
    // Image on line 2; cursor stays on line 1 so the onCursorLine gate
    // doesn't fall back to source mode for the image line.
    const view = mount("text\n![](https://example.com/a.png)\n");
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement | null;
    expect(figure).toBeTruthy();
    const content = figure!.querySelector(":scope > .cm-img-content");
    expect(content).toBeTruthy();
    expect(content!.querySelector(":scope > .cm-img-wrap > img.cm-preview-img")).toBeTruthy();
    // No caption → no figcaption in the shell.
    expect(figure!.querySelector("figcaption")).toBeNull();
    expect(figure!.parentElement?.classList.contains("cm-content")).toBe(true);
    expect(figure!.closest(".cm-line")).toBeNull();
  });

  it("renders a static figcaption when the image has a caption (non-active shell)", () => {
    const view = mount("text\n![图注](https://example.com/a.png)\n");
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement | null;
    expect(figure).toBeTruthy();
    const fig = figure!.querySelector("figcaption.cm-preview-figcaption");
    expect(fig).toBeTruthy();
    expect(fig!.textContent).toBe("图注");
    expect(fig!.parentElement?.classList.contains("cm-img-content")).toBe(true);
    expect(getComputedStyle(fig!).textAlign).toBe("center");
  });

  it("selects only the image surface and keeps the centered caption outside it", () => {
    const view = mount("text\n![图注](https://example.com/a.png)\n");
    const detach = attachImageToolbar(view);
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement;
    const image = figure.querySelector(".cm-preview-img") as HTMLElement;

    image.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    image.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const wrap = figure.querySelector(".cm-img-wrap") as HTMLElement;
    const input = figure.querySelector(".cm-img-caption-input") as HTMLInputElement;
    expect(wrap.classList.contains("cm-img-active")).toBe(true);
    expect(figure.classList.contains("cm-img-active")).toBe(false);
    expect(wrap.contains(input)).toBe(false);
    expect(input.parentElement).toBe(wrap.parentElement);
    expect(input.value).toBe("图注");
    expect(getComputedStyle(input).textAlign).toBe("center");

    detach();
    view.destroy();
  });

  it("keeps caption pointer events out of CodeMirror so the input can retain focus", () => {
    const widget = new ImgWidget("![](a.png)", 0, 11);
    const input = document.createElement("input");
    input.className = "cm-img-caption-input";
    let ignored = false;
    input.addEventListener("mousedown", (event) => {
      ignored = widget.ignoreEvent(event);
    });

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(ignored).toBe(true);
  });

  it("shows the saved caption again after the image is deselected", () => {
    const view = mount("text\n![始终可见](https://example.com/a.png)\n");
    const detach = attachImageToolbar(view);
    const figure = view.dom.querySelector(".cm-preview-figure") as HTMLElement;
    const image = figure.querySelector(".cm-preview-img") as HTMLElement;
    const caption = figure.querySelector(".cm-preview-figcaption") as HTMLElement;

    image.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    image.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(figure.querySelector(".cm-img-caption-input")).toBeTruthy();

    view.dom.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(figure.querySelector(".cm-img-caption-input")).toBeNull();
    expect(caption.style.display).not.toBe("none");
    expect(caption.textContent).toBe("始终可见");

    detach();
    view.destroy();
  });

  it("uses icon-only alignment controls with accessible labels", () => {
    const view = mount("text\n![](https://example.com/a.png){.center}\n");
    const detach = attachImageToolbar(view);
    const image = view.dom.querySelector(".cm-preview-img") as HTMLElement;
    image.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    image.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const buttons = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-img-toolbar button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "图片左对齐",
      "图片居中",
      "图片右对齐",
    ]);
    expect(buttons.map((button) => button.textContent)).toEqual(["", "", ""]);
    expect(buttons.map((button) => button.querySelector("i")?.className)).toEqual([
      "fn-icon ph ph-align-left",
      "fn-icon ph ph-align-center-horizontal",
      "fn-icon ph ph-align-right",
    ]);

    detach();
    view.destroy();
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
    expect(figure.querySelector(".cm-img-wrap")?.classList.contains("cm-img-active")).toBe(true);

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
