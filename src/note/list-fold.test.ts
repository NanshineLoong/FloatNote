import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Autolink, Strikethrough, Table, TaskList } from "@lezer/markdown";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { listFoldField, ListFoldEffect, parseListItems, remapFolded } from "./list-fold";
import { OutlineToggleEffect, outlineMode } from "./outline-mode";

function state(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Autolink, Table, Strikethrough, TaskList] })],
  });
}

function decorations(set: DecorationSet): Array<{ from: number; to: number; spec: any }> {
  const out: Array<{ from: number; to: number; spec: any }> = [];
  const cur = set.iter();
  while (cur.value) {
    out.push({ from: cur.from, to: cur.to, spec: (cur.value as Decoration).spec });
    cur.next();
  }
  return out;
}

function byText(items: ReturnType<typeof parseListItems>, text: string) {
  return items.find((i) => i.text === text)!;
}

function hasFoldedSubtree(state: EditorState) {
  return decorations(state.field(listFoldField).decorations)
    .some((d) => d.spec.block === true && d.spec.widget === undefined);
}

describe("parseListItems", () => {
  it("flags only items with a nested list as having children", () => {
    const items = parseListItems(
      state("- a\n  - a1\n  - a2\n    - a2x\n- b\n"),
    );
    expect(byText(items, "a").hasChildren).toBe(true);
    expect(byText(items, "a2").hasChildren).toBe(true);
    expect(byText(items, "a1").hasChildren).toBe(false);
    expect(byText(items, "a2x").hasChildren).toBe(false);
    expect(byText(items, "b").hasChildren).toBe(false);
  });

  it("computes depth and the nested-subtree replacement span", () => {
    const doc = "- a\n  - a1\n  - a2\n    - a2x\n- b\n";
    const items = parseListItems(state(doc));
    const a = byText(items, "a");
    const a2 = byText(items, "a2");
    // depth: top-level 0, a2 is one level deeper
    expect(a.depth).toBe(0);
    expect(a2.depth).toBe(1);
    // `from` lands on the marker (after leading indent), not the line start
    expect(doc[a.from]).toBe("-");
    // child span starts at the first child line's start (indent absorbed)
    expect(doc[a.childFrom]).toBe(" ");
    expect(doc[a.childFrom + 2]).toBe("-"); // first child marker
    // child span ends at the end of the nested subtree (trailing newline absorbed)
    expect(doc.slice(a.childFrom, a.childTo)).toBe("  - a1\n  - a2\n    - a2x\n");
  });

  it("counts all descendant ListItems", () => {
    const items = parseListItems(state("- a\n  - a1\n  - a2\n    - a2x\n- b\n"));
    // 折叠 `- a` 的子树覆盖 a1 / a2 / a2x；折叠 `- a2` 的子树覆盖 a2x。
    const a = byText(items, "a");
    const a2 = byText(items, "a2");
    expect(items.filter((o) => o.from > a.childFrom && o.from < a.childTo)).toHaveLength(3);
    expect(items.filter((o) => o.from > a2.childFrom && o.from < a2.childTo)).toHaveLength(1);
  });

  it("handles ordered lists and task lists", () => {
    const items = parseListItems(
      state("1. first\n   2. nested\n3. third\n- [ ] task\n  - [x] subtask\n"),
    );
    const first = byText(items, "first");
    const task = items.find((i) => i.text.startsWith("[ ]"))!;
    expect(first.hasChildren).toBe(true);
    expect(first.depth).toBe(0);
    expect(task.hasChildren).toBe(true);
    expect(task.text).toBe("[ ] task");
  });

  it("produces no children for a flat list", () => {
    const items = parseListItems(state("- a\n- b\n- c\n"));
    expect(items.every((i) => !i.hasChildren)).toBe(true);
    expect(items).toHaveLength(3);
  });
});

describe("remapFolded", () => {
  it("carries a folded id across a position shift by mapping from", () => {
    const oldDoc = "- a\n  - a1\n  - a2\n";
    const oldItems = parseListItems(state(oldDoc));
    const a = byText(oldItems, "a");
    const folded = new Set([a.id]);

    // Prepend a line, shifting every position by 6.
    const newDoc = "intro\n- a\n  - a1\n  - a2\n";
    const newItems = parseListItems(state(newDoc));
    const next = remapFolded(folded, oldItems, newItems, (p) => p + "intro\n".length);

    const aNew = byText(newItems, "a");
    expect(next.has(aNew.id)).toBe(true);
    expect(next.size).toBe(1);
  });

  it("falls back to content+depth when the position no longer matches", () => {
    const oldDoc = "- a\n  - a1\n";
    const oldItems = parseListItems(state(oldDoc));
    const a = byText(oldItems, "a");
    const folded = new Set([a.id]);

    // Same content, but rewrite the doc so `a` sits at a different offset and
    // the position map is intentionally wrong (identity) — fallback must hit.
    const newDoc = "preamble text\n- a\n  - a1\n";
    const newItems = parseListItems(state(newDoc));
    const next = remapFolded(folded, oldItems, newItems, (p) => p); // wrong map
    const aNew = byText(newItems, "a");
    expect(next.has(aNew.id)).toBe(true);
  });

  it("drops a folded id whose item disappeared", () => {
    const oldDoc = "- a\n  - a1\n";
    const oldItems = parseListItems(state(oldDoc));
    const a = byText(oldItems, "a");
    const folded = new Set([a.id]);
    // New doc has no item at from 0 (intro prefix shifts it) and no matching
    // text+depth, so the fold can't be carried and is dropped.
    const newItems = parseListItems(state("intro\n- b\n- c\n"));
    const next = remapFolded(folded, oldItems, newItems, (p) => p); // wrong map
    expect(next.size).toBe(0);
  });
});

describe("listFoldField decorations", () => {
  function foldState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [markdown({ extensions: [Autolink, Table, Strikethrough, TaskList] }), listFoldField, ...outlineMode()],
    });
  }

  it("renders a toggle widget only on items with children", () => {
    const st = foldState("- a\n  - a1\n  - a2\n- b\n");
    const decos = decorations(st.field(listFoldField).decorations);
    const a = byText(st.field(listFoldField).items, "a");
    // parent `- a` gets a point widget (side -1) at its marker
    const toggle = decos.find((d) => d.from === a.from && d.to === a.from && d.spec.side === -1 && d.spec.widget);
    expect(toggle).toBeTruthy();
    // `- b` has no children → no widget at its marker
    const b = byText(st.field(listFoldField).items, "b");
    expect(decos.some((d) => d.from === b.from && d.to === b.from && d.spec.widget)).toBe(false);
    // nothing folded yet → no hidden lines
    expect(decos.some((d) => typeof d.spec.class === "string" && d.spec.class.includes("cm-list-fold-hidden"))).toBe(false);
  });

  it("replaces the nested subtree with a zero-height block when folded", () => {
    let st = foldState("- a\n  - a1\n  - a2\n    - a2x\n");
    const a = byText(st.field(listFoldField).items, "a");
    st = st.update({ effects: ListFoldEffect.of({ id: a.id, folded: true }) }).state;
    const decos = decorations(st.field(listFoldField).decorations);
    const foldedRange = decos.find((d) =>
      d.from === a.childFrom && d.to === a.childTo && d.spec.block === true);
    expect(foldedRange).toBeTruthy();
    expect(st.field(listFoldField).folded.has(a.id)).toBe(true);
  });

  it("unfolds on a second toggle", () => {
    let st = foldState("- a\n  - a1\n");
    const a = byText(st.field(listFoldField).items, "a");
    st = st.update({ effects: ListFoldEffect.of({ id: a.id, folded: true }) }).state;
    st = st.update({ effects: ListFoldEffect.of({ id: a.id, folded: false }) }).state;
    expect(st.field(listFoldField).folded.has(a.id)).toBe(false);
    expect(decorations(st.field(listFoldField).decorations).some((d) => typeof d.spec.class === "string" && d.spec.class.includes("cm-list-fold-hidden"))).toBe(false);
  });

  it("defers to outline mode (no decorations while outline is on)", () => {
    let st = foldState("- a\n  - a1\n");
    const a = byText(st.field(listFoldField).items, "a");
    st = st.update({ effects: ListFoldEffect.of({ id: a.id, folded: true }) }).state;
    expect(decorations(st.field(listFoldField).decorations).some((d) => d.spec.widget)).toBe(true);
    st = st.update({ effects: OutlineToggleEffect.of(true) }).state;
    // folded set preserved, but decorations suppressed
    expect(st.field(listFoldField).folded.has(a.id)).toBe(true);
    expect(decorations(st.field(listFoldField).decorations).some((d) => d.spec.widget)).toBe(false);
    // turning outline off restores the fold (hidden lines reappear)
    st = st.update({ effects: OutlineToggleEffect.of(false) }).state;
    expect(hasFoldedSubtree(st)).toBe(true);
  });

  it("carries fold state across an edit (remap)", () => {
    let st = foldState("- a\n  - a1\n");
    const a = byText(st.field(listFoldField).items, "a");
    st = st.update({ effects: ListFoldEffect.of({ id: a.id, folded: true }) }).state;
    // Prepend a line; the `- a` item shifts but stays folded.
    st = st.update({ changes: { from: 0, insert: "intro\n" } }).state;
    const aNew = byText(st.field(listFoldField).items, "a");
    expect(aNew.from).toBe("intro\n".length);
    expect(st.field(listFoldField).folded.has(aNew.id)).toBe(true);
    expect(hasFoldedSubtree(st)).toBe(true);
  });
});
