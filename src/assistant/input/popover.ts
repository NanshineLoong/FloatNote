/**
 * 候选列表 popover（caret-following，`@` 与 `/` 复用同一套）。
 *
 * - 定位在当前输入位置附近：用 EditorView.coordsAtPos 取触发区起点像素坐标，
 *   优先浮在光标上方，空间不足翻到下方；窗口缩放/滚动/内容换行时由调用方
 *   调 reposition() 重算（composer 在 CM6 update/scroll/resize 时触发）。
 * - 键盘：move(±1) 循环切换、confirm() 返回当前 Ref、close()。调用方在 CM6
 *   keymap 里 ArrowUp/Down/Enter/Tab/Esc 调这些并 preventDefault。
 * - 鼠标：hover 同步 active（键盘焦点跟随指针）、click 确认、外部 mousedown 关闭。
 * - 关闭后不影响已有内容：popover 只管自己的可见性与 active；不触碰文档。
 */
import { EditorView, type Rect } from "@codemirror/view";
import type { Ref } from "./model";
import type { ScoredCandidate } from "./filter";

export interface RefPopoverOptions {
  /** 取当前 EditorView（popover 不持有 view 引用，避免与 overlay 切换竞态）。 */
  editorView: () => EditorView | null;
  /** 选中候选项时调用：替换 trigger 区间为引用 token，由 composer dispatch。 */
  onSelect: (ref: Ref, trigger: { from: number; to: number }) => void;
  /** popover 关闭时（外点/Esc/confirm 后）回调，供调用方清状态。 */
  onClose?: () => void;
}

const GAP = 6;

export class RefPopover {
  private el: HTMLElement;
  private items: ScoredCandidate[] = [];
  private active = 0;
  private trigger: { from: number; to: number } | null = null;
  private readonly opts: RefPopoverOptions;

  constructor(opts: RefPopoverOptions) {
    this.opts = opts;
    const el = document.createElement("div");
    el.className = "fn-popover fn-ref-popover";
    el.hidden = true;
    el.setAttribute("role", "listbox");
    el.addEventListener("mousemove", this.onMouseMove);
    el.addEventListener("click", this.onClick);
    document.body.appendChild(el);
    this.el = el;
    document.addEventListener("mousedown", this.onDocMouseDown, true);
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  show(items: ScoredCandidate[], trigger: { from: number; to: number }): void {
    this.items = items;
    this.trigger = trigger;
    this.active = 0;
    this.render();
    this.el.hidden = false;
    this.reposition();
    this.scrollActiveIntoView();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.items = [];
    this.trigger = null;
    this.opts.onClose?.();
  }

  /** 移动 active：delta=±1，循环。 */
  move(delta: number): void {
    if (this.items.length === 0) return;
    this.active = (this.active + delta + this.items.length) % this.items.length;
    this.updateActive();
    this.scrollActiveIntoView();
  }

  /** 确认当前项：返回选中 Ref，并触发 onSelect + close。无项返回 null。 */
  confirm(): Ref | null {
    if (this.items.length === 0 || !this.trigger) return null;
    const ref = this.items[this.active].candidate.ref;
    const trigger = this.trigger;
    this.close();
    this.opts.onSelect(ref, trigger);
    return ref;
  }

  /** 重新定位到触发区起点（滚动/缩放/换行后调用）。 */
  reposition(): void {
    if (this.el.hidden || !this.trigger) return;
    const view = this.opts.editorView();
    if (!view) return;
    let coords: Rect | null;
    try {
      coords = view.coordsAtPos(this.trigger.from);
    } catch {
      return;
    }
    if (!coords) return;
    const margin = 8;
    const placeAbove = coords.top - this.el.offsetHeight - GAP >= margin;
    this.el.style.left = `${Math.max(margin, coords.left)}px`;
    if (placeAbove) {
      this.el.style.top = "auto";
      this.el.style.bottom = `${Math.max(margin, window.innerHeight - coords.top + GAP)}px`;
    } else {
      this.el.style.bottom = "auto";
      this.el.style.top = `${Math.min(window.innerHeight - this.el.offsetHeight - margin, coords.bottom + GAP)}px`;
    }
    // 右侧不溢出
    const maxLeft = window.innerWidth - this.el.offsetWidth - margin;
    const leftNum = parseFloat(this.el.style.left) || 0;
    if (leftNum > maxLeft) this.el.style.left = `${Math.max(margin, maxLeft)}px`;
  }

  private render(): void {
    this.el.replaceChildren();
    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fn-ref-popover-empty";
      empty.textContent = "没有匹配项";
      this.el.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "fn-ref-popover-list";
    this.items.forEach((sc, idx) => {
      const ref = sc.candidate.ref;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "fn-ref-popover-item";
      item.dataset.index = String(idx);
      if (idx === this.active) item.classList.add("active");
      const kind = document.createElement("span");
      kind.className = "fn-ref-popover-kind";
      kind.textContent = ref.kind === "file" ? "文件" : "Skill";
      const label = document.createElement("span");
      label.className = "fn-ref-popover-label";
      label.textContent = ref.display;
      item.append(kind, label);
      if (sc.candidate.description) {
        const desc = document.createElement("span");
        desc.className = "fn-ref-popover-desc";
        desc.textContent = sc.candidate.description;
        item.appendChild(desc);
      }
      list.appendChild(item);
    });
    this.el.appendChild(list);
  }

  private updateActive(): void {
    this.el.querySelectorAll(".fn-ref-popover-item").forEach((node) => {
      const idx = Number((node as HTMLElement).dataset.index);
      (node as HTMLElement).classList.toggle("active", idx === this.active);
    });
  }

  private scrollActiveIntoView(): void {
    const node = this.el.querySelector(".fn-ref-popover-item.active");
    if (node && typeof (node as Element).scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }

  private setActive(idx: number): void {
    if (idx < 0 || idx >= this.items.length) return;
    this.active = idx;
    this.updateActive();
  }

  private onMouseMove = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target.closest("[data-index]") : null;
    if (!target) return;
    this.setActive(Number(target.getAttribute("data-index")));
  };

  private onClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target.closest("[data-index]") : null;
    if (!target) return;
    e.preventDefault();
    this.setActive(Number(target.getAttribute("data-index")));
    this.confirm();
  };

  private onDocMouseDown = (e: MouseEvent): void => {
    if (this.el.hidden) return;
    const target = e.target;
    if (target instanceof Node && this.el.contains(target)) return;
    this.close();
  };

  destroy(): void {
    document.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.el.remove();
  }
}
