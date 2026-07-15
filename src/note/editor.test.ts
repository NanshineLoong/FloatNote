// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, Table, TaskList } from "@lezer/markdown";
import { describe, expect, it, vi } from "vitest";
import {
  createEditor,
  replaceDocWithoutHistory,
  requestEditorLayout,
  setDoc,
  setEditorReadOnly,
} from "./editor";
import { livePreview, previewField } from "./preview";
import type { Decoration, DecorationSet } from "@codemirror/view";

/** Collect every decoration from the preview field as {from, to, spec}. */
function decorations(set: DecorationSet): Array<{ from: number; to: number; spec: any }> {
  const out: Array<{ from: number; to: number; spec: any }> = [];
  const cur = set.iter();
  while (cur.value) {
    out.push({ from: cur.from, to: cur.to, spec: (cur.value as Decoration).spec });
    cur.next();
  }
  return out;
}

/** Build a state with the same markdown grammar + live preview as the real
 *  editor, without spinning up an EditorView (avoids jsdom layout measure). */
function previewState(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Table, Strikethrough, TaskList] }), ...livePreview()],
    selection: { anchor: cursor },
  });
}

describe("requestEditorLayout", () => {
  it("requests a CodeMirror measurement on the next frame", () => {
    const requestMeasure = vi.fn();
    const schedule = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    requestEditorLayout({ requestMeasure }, schedule);

    expect(schedule).toHaveBeenCalledOnce();
    expect(requestMeasure).toHaveBeenCalledOnce();
  });
});

describe("setDoc undo", () => {
  it("setDoc is undoable in-session (AI write can be reverted with ⌘Z)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});
    try {
      // Seed the original document WITHOUT recording history, so the only
      // history-tracked transaction is the AI write below.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "原文" },
        annotations: Transaction.addToHistory.of(false),
      });

      setDoc(view, "AI 改写后");
      expect(view.state.doc.toString()).toBe("AI 改写后");

      undo(view);
      expect(view.state.doc.toString()).toBe("原文");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("setEditorReadOnly", () => {
  it("toggles the editor read-only facet for version preview", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});
    try {
      expect(view.state.readOnly).toBe(false);
      setEditorReadOnly(view, true);
      expect(view.state.readOnly).toBe(true);
      setEditorReadOnly(view, false);
      expect(view.state.readOnly).toBe(false);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("replaceDocWithoutHistory", () => {
  it("keeps version previews out of undo history", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "base" },
        annotations: Transaction.addToHistory.of(false),
      });
      setDoc(view, "current edit");
      const originalState = view.state;
      replaceDocWithoutHistory(view, "historical preview");
      view.setState(originalState);

      undo(view);

      expect(view.state.doc.toString()).toBe("base");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("editor selection rendering", () => {
  it("uses native text selection and adds a cue for selected line breaks", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});
    try {
      setDoc(view, "alpha\n\nomega");
      view.dispatch({ selection: { anchor: 1, head: 8 } });

      expect(view.dom.querySelector(".cm-selectionLayer")).toBeNull();
      expect(view.dom.querySelectorAll(".cm-selected-line-break")).toHaveLength(2);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("explicit line-break spacing", () => {
  it("keeps the gap inside the measured line box", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = createEditor(host, () => {});
    try {
      setDoc(view, "first\nsecond");
      const secondLine = Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-line"))
        .find((line) => line.textContent === "second");

      expect(secondLine?.classList.contains("cm-hard-break-line")).toBe(true);
      expect(getComputedStyle(secondLine!).marginTop).not.toBe("0.26em");
      expect(getComputedStyle(secondLine!).paddingTop).toBe("0.26em");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("fenced code block is editable text (no block widget)", () => {
  // Cursor parked in the leading paragraph so it doesn't touch any fence
  // CodeMark (which would reveal the fence and skip the hide decoration).
  const DOC = "intro line\n\n```ts\nconst x = 1\n```\n";

  // Lines (1-based): 1 "intro line", 2 "", 3 "```ts", 4 "const x = 1", 5 "```".
  function lineFrom(state: EditorState, n: number) {
    return state.doc.line(n).from;
  }

  it("styles every code-block line with cm-codeblock (no block widget)", () => {
    const state = previewState(DOC, 3);
    const decos = decorations(state.field(previewField));
    const lineDecos = decos.filter((d) => typeof d.spec.class === "string" && d.spec.class.includes("cm-codeblock"));
    const starts = lineDecos.map((d) => d.from).sort((a, b) => a - b);
    expect(starts).toEqual([lineFrom(state, 3), lineFrom(state, 4), lineFrom(state, 5)]);

    // No block-level replace widget remains over the code block (the old
    // CodeBlockWidget is gone): this doc has no table, only a code block, so
    // there must be no block:true decoration at all.
    const blockWidgets = decos.filter((d) => d.spec.block === true);
    expect(blockWidgets).toEqual([]);
  });

  it("hides the fence CodeMark and keeps the body untouched", () => {
    const state = previewState(DOC, 3);
    const decos = decorations(state.field(previewField));
    const fenceOpenFrom = lineFrom(state, 3);
    const fenceCloseFrom = lineFrom(state, 5);
    const bodyFrom = lineFrom(state, 4);

    // A hide is a replace decoration with no widget, no class, not block.
    const isHide = (d: { spec: any }) =>
      d.spec.widget === undefined && d.spec.block !== true && d.spec.class === undefined;
    const hides = decos.filter((d) => d.to > d.from && isHide(d));
    const fenceFroms = hides.map((d) => d.from).sort((a, b) => a - b);
    expect(fenceFroms).toContain(fenceOpenFrom);
    expect(fenceFroms).toContain(fenceCloseFrom);

    // The body line text carries no hide/replace decoration — it stays live.
    const bodyLine = state.doc.line(4);
    const bodyHides = decos.filter(
      (d) => d.from < bodyLine.to && d.to > bodyLine.from && d.to > d.from && isHide(d),
    );
    expect(bodyHides).toEqual([]);
    expect(bodyFrom).toBe(bodyLine.from);
  });

  it("reveals both fences when the caret enters any code-block line", () => {
    const bodyCursor = DOC.indexOf("const x");
    const state = previewState(DOC, bodyCursor);
    const decos = decorations(state.field(previewField));
    const open = lineFrom(state, 3);
    const close = lineFrom(state, 5);
    const hiddenFenceStarts = decos
      .filter((d) => d.to > d.from && d.spec.widget === undefined && d.spec.class === undefined)
      .map((d) => d.from);

    expect(hiddenFenceStarts).not.toContain(open);
    expect(hiddenFenceStarts).not.toContain(close);
  });
});

describe("table widget (click-cell-to-reveal)", () => {
  // Lead paragraph so the caret (parked in it) is off the table → the table
  // renders as a widget (cursor on a table line would trip the reveal gate).
  const DOC = "intro line\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";

  it("renders one cell per header+body cell with inline-rendered text", () => {
    const state = previewState(DOC, 3);
    const decos = decorations(state.field(previewField));
    const tableDeco = decos.find((d) => d.spec.block === true && d.spec.widget);
    expect(tableDeco).toBeTruthy();
    const w = tableDeco!.spec.widget as any;

    // toDOM only builds DOM (the mousedown handler closes over `view` but
    // isn't invoked here), so a stub view is enough.
    const dom = w.toDOM({});
    const cells = Array.from(dom.querySelectorAll("th, td")) as HTMLElement[];
    // 2 header + 1 body row × 2 cols.
    expect(cells.length).toBe(4);
    expect(cells[0].textContent).toBe("a");
    expect(cells[3].textContent).toBe("2");
    // Cells are NOT contenteditable (WYSIWYG-in-widget isn't viable in CM6);
    // clicking a cell dispatches the caret into the source instead.
    expect(cells[0].getAttribute("contenteditable")).toBeNull();
  });
});
