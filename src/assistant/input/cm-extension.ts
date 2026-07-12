/**
 * CM6 扩展：引用 token 区间管理 + 原子区间 + chip widget 装饰 + 主题。
 *
 * 引用数据编码在文档 token 里（model.ts 的 REF_OPEN…JSON…REF_CLOSE），所以：
 *  - 不用 effect / side-table → redo 不重放 effect 的丢引用问题不存在；
 *  - refField 每次 update 扫描文档重建 refs+decos，随文本 undo/redo/复制天然保留；
 *  - atomicRanges 把每个 token 区间当原子：光标不进内部、Backspace 整体删；
 *  - 装饰用 Decoration.replace + RefWidget 把 token 视觉替换成 chip。
 */
import { StateField, RangeSet, RangeSetBuilder, RangeValue } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Ref } from "./model";
import { REF_OPEN, REF_CLOSE, refToken, refsInDoc, parseDoc } from "./model";
import { RefWidget } from "./ref-widget";

interface RefState {
  /** refs 按文档顺序；与 decos 一一对应。 */
  refs: Ref[];
  /** 每个 ref token 的 [from,to) 区间，供 atomicRanges 用。 */
  ranges: Array<{ from: number; to: number; ref: Ref }>;
  decos: DecorationSet;
}

/** RangeValue 包装 Ref，供 RangeSet 作为 atomicRanges 值（仅用区间，值不比较语义）。 */
class RefAtom extends RangeValue {
  constructor(readonly ref: Ref) {
    super();
  }
  compare(other: RefAtom): boolean {
    return (
      this.ref.id === other.ref.id &&
      this.ref.kind === other.ref.kind &&
      this.ref.display === other.ref.display
    );
  }
}

/** 扫描文档，找出所有 ref token 的区间与 Ref。返回有序列表。 */
function scanRefs(doc: { sliceString: (from: number, to: number) => string; length: number }): {
  ranges: Array<{ from: number; to: number; ref: Ref }>;
} {
  const text = doc.sliceString(0, doc.length);
  const ranges: Array<{ from: number; to: number; ref: Ref }> = [];
  const segs = parseDoc(text);
  let pos = 0;
  for (const seg of segs) {
    if (seg.type === "text") {
      pos += seg.text.length;
    } else {
      const len = REF_OPEN.length + JSON.stringify(seg.ref).length + REF_CLOSE.length;
      ranges.push({ from: pos, to: pos + len, ref: seg.ref });
      pos += len;
    }
  }
  return { ranges };
}

/** 从有序 ranges 重建装饰（每个 token 替换为 chip）+ 原子区间 RangeSet。 */
function buildFromRanges(
  ranges: Array<{ from: number; to: number; ref: Ref }>,
  docLength: number,
): { decos: DecorationSet; atoms: RangeSet<RefAtom> } {
  const decoBuilder = new RangeSetBuilder<Decoration>();
  const atomBuilder = new RangeSetBuilder<RefAtom>();
  for (const r of ranges) {
    decoBuilder.add(r.from, r.to, Decoration.replace({ widget: new RefWidget(r.ref), inclusive: false }));
    atomBuilder.add(r.from, r.to, new RefAtom(r.ref));
  }
  return { decos: decoBuilder.finish(), atoms: atomBuilder.finish() };
}

export const refField = StateField.define<RefState>({
  create(state) {
    const { ranges } = scanRefs(state.doc);
    const built = buildFromRanges(ranges, state.doc.length);
    return { refs: ranges.map((r) => r.ref), ranges, decos: built.decos };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const { ranges } = scanRefs(tr.state.doc);
    const built = buildFromRanges(ranges, tr.state.doc.length);
    return { refs: ranges.map((r) => r.ref), ranges, decos: built.decos };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.atomicRanges.of((view: EditorView) => buildAtoms(view.state.field(f).ranges, view.state.doc.length)),
  ],
});

/** 为 atomicRanges 重建 RangeSet<RefAtom>（与 decos 同源）。 */
function buildAtoms(
  ranges: Array<{ from: number; to: number; ref: Ref }>,
  docLength: number,
): RangeSet<RefAtom> {
  void docLength;
  const b = new RangeSetBuilder<RefAtom>();
  for (const r of ranges) b.add(r.from, r.to, new RefAtom(r.ref));
  return b.finish();
}

/** 读取当前有序引用列表（供提交 payload 与复制序列化）。 */
export function refList(state: { doc: { toString: () => string } }): Ref[] {
  return refsInDoc(state.doc.toString());
}

/** 在指定区间插入引用 token 的事务参数。调用方 dispatch 之。
 *  to 缺省 = from（纯插入）；popover 确认时 to 为 trigger 末尾以替换 `@query`。 */
export function insertRefTransaction(ref: Ref, from: number, to: number = from): {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
  userEvent: string;
} {
  const token = refToken(ref);
  return {
    changes: { from, to, insert: token },
    selection: { anchor: from + token.length },
    userEvent: "input.ref",
  };
}

/** 输入框主题：单行/多行自适应、字体、max-height 内部滚动。 */
export const inputTheme = EditorView.theme(
  {
    ".fn-assistant-input": {
      flex: "1",
      maxHeight: "120px",
      border: "var(--fn-border-hair) solid",
      borderRadius: "18px",
      fontSize: "var(--fs-md)",
      lineHeight: "1.4",
      padding: "9px 12px",
      caretColor: "var(--color-text)",
      background: "var(--color-surface)",
      overflowY: "auto",
      "&.cm-focused": { outline: "none" },
    },
    ".fn-assistant-input .cm-scroller": { overflowY: "auto" },
    ".fn-assistant-input .cm-content": { padding: "0" },
    ".fn-assistant-input .cm-line": { padding: "0" },
  },
  { dark: false },
);

/** 组合：refField + 主题。供 composer 一次性挂载。 */
export function refExtension(): Extension {
  return [refField, inputTheme];
}
