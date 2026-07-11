/**
 * 引用 chip 的 CM6 WidgetType：把文档里的引用哨兵字符视觉替换成 .fn-ref-chip。
 *
 * chip 是 contenteditable=false 的独立 span，挂在原子区间上：
 *  - 光标无法进入内部（由 cm-extension 的 atomicRanges 保证）；
 *  - Backspace/Delete 命中原子边界时整体删区间（CM6 原生原子删除语义）；
 *  - X 按钮经 posAtDOM 定位当前哨兵位置后 dispatch 删除。
 *
 * 显示名(display) 与内部 id 分离：widget 只用 ref.display 渲染，解析走 ref.id。
 */
import { EditorView, WidgetType } from "@codemirror/view";
import type { Ref } from "./model";
import { findRefTokenRange } from "./model";

const KIND_LABEL: Record<Ref["kind"], string> = {
  file: "文件",
  skill: "Skill",
};

export class RefWidget extends WidgetType {
  constructor(readonly ref: Ref) {
    super();
  }

  /** id+kind+display 全等才复用实例，避免 display 变化时不刷新。 */
  eq(other: RefWidget): boolean {
    return (
      this.ref.id === other.ref.id &&
      this.ref.kind === other.ref.kind &&
      this.ref.display === other.ref.display
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "fn-ref-chip";
    span.setAttribute("contenteditable", "false");
    span.dataset.refId = this.ref.id;
    span.dataset.refKind = this.ref.kind;

    const label = document.createElement("span");
    label.className = "fn-ref-chip-label";
    label.textContent = this.ref.display;

    const kind = document.createElement("span");
    kind.className = "fn-ref-chip-kind";
    kind.textContent = KIND_LABEL[this.ref.kind];

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "fn-ref-chip-x";
    remove.setAttribute("aria-label", "移除引用");
    remove.textContent = "×";
    remove.addEventListener("mousedown", (e) => {
      // 阻止编辑器抢焦点/移动光标，先删哨兵再聚焦。
      e.preventDefault();
      e.stopPropagation();
    });
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      const pos = view.posAtDOM(span);
      const text = view.state.doc.toString();
      const range = findRefTokenRange(text, pos);
      if (range) {
        view.dispatch({
          changes: { from: range.from, to: range.to },
          selection: { anchor: range.from },
          scrollIntoView: true,
        });
        view.focus();
      }
    });

    span.append(kind, label, remove);
    return span;
  }

  /** X 按钮需自己处理点击，不让编辑器吞掉。 */
  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click" ? false : true;
  }
}
