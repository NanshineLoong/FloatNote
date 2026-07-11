// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { refExtension, refList, insertRefTransaction } from "./cm-extension";
import { refToken, parseDoc } from "./model";
import type { Ref } from "./model";

const FILE: Ref = { kind: "file", id: "p/piece.md", display: "piece.md", meta: { noteKind: "piece" } };

function mount(doc = ""): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), refExtension()],
    }),
    parent: host,
  });
}

function insertRef(view: EditorView, ref: Ref, at = view.state.selection.main.head): void {
  view.dispatch(insertRefTransaction(view, ref, at));
}

describe("ref chip CM6 basecoat", () => {
  let view: EditorView;
  beforeEach(() => {
    view = mount("你好");
  });
  afterEach(() => {
    view.destroy();
    document.body.replaceChildren();
  });

  it("插入引用后文档含 token + side-field 注册", () => {
    insertRef(view, FILE, 2);
    expect(view.state.doc.toString()).toBe(`你好${refToken(FILE)}`);
    expect(refList(view.state)).toEqual([FILE]);
  });

  it("refList 按文档顺序返回多个引用", () => {
    insertRef(view, FILE, 0);
    insertRef(view, { ...FILE, id: "p/tasks.md", display: "_tasks.md" }, refToken(FILE).length);
    expect(refList(view.state).map((r) => r.id)).toEqual(["p/piece.md", "p/tasks.md"]);
  });

  it("Backspace 整体删 token：清掉对应 ref，不影响其他", () => {
    insertRef(view, FILE, 0); // <token>你好
    insertRef(view, { ...FILE, id: "p/tasks.md", display: "_tasks.md" }, refToken(FILE).length); // <token><token2>你好
    const firstLen = refToken(FILE).length;
    view.dispatch({ changes: { from: 0, to: firstLen }, selection: { anchor: 0 } });
    expect(refList(view.state).map((r) => r.id)).toEqual(["p/tasks.md"]);
  });

  it("undo/redo 保留 chip：undo 撤掉 token，redo 还原引用", () => {
    insertRef(view, FILE, 2);
    expect(refList(view.state)).toEqual([FILE]);

    undo(view);
    expect(view.state.doc.toString()).toBe("你好");
    expect(refList(view.state)).toEqual([]);

    redo(view);
    expect(view.state.doc.toString()).toBe(`你好${refToken(FILE)}`);
    expect(refList(view.state)).toEqual([FILE]);
  });

  it("文档变更时 token 随文本迁移、引用不丢", () => {
    insertRef(view, FILE, 2); // 你好<token>
    view.dispatch({ changes: { from: 0, insert: "哈" }, selection: { anchor: 1 } });
    expect(view.state.doc.toString()).toBe(`哈你好${refToken(FILE)}`);
    expect(refList(view.state)).toEqual([FILE]);
  });

  it("提交用 parseDoc：文本与引用交织正确", () => {
    insertRef(view, FILE, 2);
    const segs = parseDoc(view.state.doc.toString());
    expect(segs).toEqual([
      { type: "text", text: "你好" },
      { type: "ref", ref: FILE },
    ]);
  });
});

void EditorSelection;
