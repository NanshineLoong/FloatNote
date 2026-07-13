// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { listFold, listFoldField, ListFoldEffect } from "./list-fold";
import { livePreview } from "./preview";

function mount(doc: string, selection: number): EditorView {
  const parent = document.createElement("div");
  document.body.replaceChildren(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [markdown(), ...livePreview(), ...listFold()],
    }),
  });
}

describe("list fold editor interaction", () => {
  it("applies the full first-level list inset through the final CodeMirror theme", () => {
    const view = mount("- item\n", 2);
    const line = view.dom.querySelector<HTMLElement>(".cm-preview-list");

    expect(line).toBeTruthy();
    expect(getComputedStyle(line!).paddingLeft).toBe("1.5em");
    view.destroy();
  });

  it("keeps the chevron track to the right of the content edge", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toMatch(
      /\.cm-list-fold-toggle\s*\{[^}]*margin:\s*0 2px 0 -20px;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(/\.cm-list-fold-chevron\s*\{[^}]*font-size:\s*18px;/s);
    expect(css).not.toMatch(/\.cm-list-leaf-dot,\s*\.cm-preview-ol-mark\s*\{[^}]*margin-left:/s);
  });

  it("uses a solid circular hover surface instead of a marker ring", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toMatch(/\.cm-list-fold-toggle:hover\s*\{[^}]*color:\s*var\(--color-accent\);/s);
    expect(css).not.toMatch(/\.cm-list-fold-toggle:hover[^}]*box-shadow:/s);
    expect(css).toMatch(
      /\.cm-list-fold-marker::before,\s*\.cm-preview-ol-number::before\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--color-hover\);/s,
    );
    expect(css).toMatch(
      /\.cm-preview-ol-mark\.cm-list-fold-marker:is\(:hover, \.cm-list-fold-marker-folded\) \.cm-preview-ol-number::before\s*\{[^}]*opacity:\s*1;/s,
    );
    expect(css).not.toMatch(/\.cm-list-fold-marker[^}]*box-shadow:/s);
  });

  it("centers an ordered-list hover circle on the number without its delimiter", () => {
    const doc = "1. parent\n   1. child\n2. tail\n";
    const view = mount(doc, doc.indexOf("tail"));
    view.requestMeasure();
    const marker = view.dom.querySelector<HTMLElement>(".cm-preview-ol-mark");

    expect(marker).toBeTruthy();
    expect(marker!.querySelector(".cm-preview-ol-number")?.textContent).toBe("1");
    expect(marker!.querySelector(".cm-preview-ol-delim")?.textContent).toBe(".");
    view.destroy();
  });

  it("keeps the next sibling list item inset after folding a subtree", () => {
    const doc = "1. first\n2. second\n   1. child\n3. third\n";
    const view = mount(doc, doc.indexOf("third"));
    const parent = view.state.field(listFoldField).items.find((item) => item.text === "second");
    expect(parent).toBeTruthy();

    view.dispatch({ effects: ListFoldEffect.of({ id: parent!.id, folded: true }) });
    const siblingLine = Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-line"))
      .find((line) => line.textContent?.includes("third"));

    expect(siblingLine).toBeTruthy();
    expect(siblingLine!.classList.contains("cm-preview-list")).toBe(true);
    expect(getComputedStyle(siblingLine!).paddingLeft).toBe("1.5em");
    view.destroy();
  });

  it("keeps the selection when the chevron is used to toggle folding", () => {
    const doc = "- parent\n  - child\n- tail\n";
    const view = mount(doc, doc.indexOf("tail"));
    const chevron = view.dom.querySelector<HTMLElement>(".cm-list-fold-toggle");
    expect(chevron).toBeTruthy();
    const before = view.state.selection.main;

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    chevron!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(view.state.selection.main).toEqual(before);

    chevron!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.state.field(listFoldField).folded.size).toBe(1);
    view.destroy();
  });

  it("keeps the selection when a parent bullet is used to toggle folding", () => {
    const doc = "- parent\n  - child\n- tail\n";
    const view = mount(doc, doc.indexOf("tail"));
    view.requestMeasure();
    const bullet = view.dom.querySelector<HTMLElement>(".cm-list-leaf-dot");
    expect(bullet).toBeTruthy();
    const before = view.state.selection.main;

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bullet!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(view.state.selection.main).toEqual(before);

    bullet!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(view.state.field(listFoldField).folded.size).toBe(1);
    view.destroy();
  });
});
