import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/**
 * 拖选自动滚动：按住左键拖出选区、指针贴近或越过滚动容器上下边缘时，
 * 容器按越界距离加速滚动，选区随滚动持续生长。
 *
 * 为什么不用 CM 原生 drag-scroll：它在 mousedown 时用 scrollableParents()
 * 找「第一个 scrollHeight > clientHeight 的祖先」当滚动容器——grow 模式下
 * #piece-editor-root 被 flex 压缩、内容溢出（满足尺寸条件但 overflow:visible
 * 不可滚）被误判，真正的 #piece-scroll 永远轮不到；且原生触发带只有 6px、
 * 50ms 一跳。这里改为运行时按 overflowY 找真实可滚祖先，grow 外层滚动、
 * 内部滚动与助手输入框共用同一实现。
 */

/** 触发带高度（px）：指针进入滚动容器上下边缘该范围即开始滚动。 */
const TRIGGER_MARGIN = 32;
/** 基础速度（px/帧）：进入触发带即以此速度滚动。 */
const BASE_SPEED = 6;
/** 速度增益：指针越出容器每多 1px，速度 +0.5px/帧。 */
const SPEED_GAIN = 0.5;
/** 速度上限（px/帧）。 */
const MAX_SPEED = 28;

/** 越界距离 → 每帧滚动像素（带内 overshoot ≤ 0，恒为基础速度；越界越远越快）。 */
export function dragScrollSpeed(overshoot: number): number {
  return Math.min(BASE_SPEED + SPEED_GAIN * Math.max(0, overshoot), MAX_SPEED);
}

/** 从编辑器 DOM 向上找第一个真正可纵向滚动的祖先；没有可滚内容时返回 null。 */
export function findScrollParent(dom: HTMLElement): HTMLElement | null {
  for (let cur = dom.parentElement; cur; cur = cur.parentElement) {
    const overflowY = getComputedStyle(cur).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
  }
  return null;
}

export interface DragScrollOptions {
  /** 测试缝：替换 requestAnimationFrame / cancelAnimationFrame。 */
  schedule?: (cb: FrameRequestCallback) => number;
  cancel?: (handle: number) => void;
}

export function dragScroll(opts: DragScrollOptions = {}): Extension {
  const schedule = opts.schedule ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const cancelFrame = opts.cancel ?? ((handle: number) => cancelAnimationFrame(handle));

  return ViewPlugin.fromClass(
    class {
      private scroller: HTMLElement | null = null;
      /** 拖动起点（首个 mousemove 时捕获，此时 CM 已处理完 mousedown）。 */
      private anchor = -1;
      private lastX = 0;
      private lastY = 0;
      private speedY = 0;
      private frame = -1;

      constructor(private readonly view: EditorView) {}

      startDrag(event: MouseEvent): void {
        // 只接管左键单击拖动；双击/三击的词、行粒度拖选仍走 CM 原生逻辑。
        if (event.button !== 0 || event.detail !== 1 || this.scroller) return;
        const scroller = findScrollParent(this.view.dom);
        if (!scroller) return;
        this.scroller = scroller;
        this.anchor = -1;
        const doc = this.view.dom.ownerDocument;
        doc.addEventListener("mousemove", this.onMove);
        doc.addEventListener("mouseup", this.onUp);
      }

      destroy(): void {
        this.stopDrag();
      }

      private readonly onMove = (event: MouseEvent): void => {
        if (event.buttons === 0) return this.stopDrag(); // mouseup 丢失兜底
        const scroller = this.scroller;
        if (!scroller || !scroller.isConnected) return this.stopDrag();
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        if (this.anchor < 0) this.anchor = this.view.state.selection.main.anchor;
        const rect = scroller.getBoundingClientRect();
        let speed = 0;
        if (event.clientY < rect.top + TRIGGER_MARGIN) {
          speed = -dragScrollSpeed(rect.top - event.clientY);
        } else if (event.clientY > rect.bottom - TRIGGER_MARGIN) {
          speed = dragScrollSpeed(event.clientY - rect.bottom);
        }
        this.setSpeed(speed);
      };

      private readonly onUp = (): void => this.stopDrag();

      private stopDrag(): void {
        const doc = this.view.dom.ownerDocument;
        doc.removeEventListener("mousemove", this.onMove);
        doc.removeEventListener("mouseup", this.onUp);
        this.setSpeed(0);
        this.scroller = null;
        this.anchor = -1;
      }

      private setSpeed(speed: number): void {
        this.speedY = speed;
        if (speed !== 0 && this.frame < 0) {
          this.frame = schedule(this.tick);
        } else if (speed === 0 && this.frame >= 0) {
          cancelFrame(this.frame);
          this.frame = -1;
        }
      }

      private readonly tick: FrameRequestCallback = () => {
        this.frame = -1;
        const scroller = this.scroller;
        if (!scroller || this.speedY === 0) return;
        scroller.scrollTop += this.speedY;
        this.extendSelection(scroller);
        if (this.speedY !== 0) this.frame = schedule(this.tick);
      };

      /** 滚动后把选区头扩展到指针（clamp 进容器 rect 内）所指的文档位置。 */
      private extendSelection(scroller: HTMLElement): void {
        if (this.anchor < 0) return;
        const rect = scroller.getBoundingClientRect();
        const x = Math.min(Math.max(this.lastX, rect.left + 1), rect.right - 1);
        const y = Math.min(Math.max(this.lastY, rect.top + 1), rect.bottom - 1);
        const pos = this.view.posAtCoords({ x, y });
        if (pos == null) return;
        const main = this.view.state.selection.main;
        if (main.anchor === this.anchor && main.head === pos) return;
        this.view.dispatch({
          selection: { anchor: this.anchor, head: pos },
          userEvent: "select.pointer",
        });
      }
    },
    {
      eventHandlers: {
        mousedown(event) {
          this.startDrag(event);
        },
      },
    },
  );
}
