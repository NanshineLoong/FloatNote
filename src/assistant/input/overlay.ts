/**
 * 大输入覆盖层：在应用内把同一份 CM6 输入器切换为固定全屏覆盖形态。
 *
 * 关键设计：不另建 EditorView、不做 state 迁移，而是给同一个输入器宿主加
 * `.fn-input-large` 类 + 背景遮罩，由 CSS 改写定位/尺寸。因为编辑器实例不变，
 * 文本 / Markdown / 光标 / 选区 / 文件引用 / Skill 引用 / 撤销重做 / IME 全部
 * 原位保留，无需任何同步逻辑。收回时去类即可。
 *
 * 只管 DOM 形态与遮罩；键盘（Esc 收回、Enter 发送）由 composer keymap 调
 * collapse()，避免与全局 Esc 链抢键。
 */
export interface InputOverlayOptions {
  /** 输入器宿主（.assistant-input-wrap）。 */
  host: HTMLElement;
  /** 展开/收回后需让 CM6 重测布局并聚焦。 */
  getView: () => { requestMeasure: () => void; focus: () => void } | null;
  /** 收回时回调（供 composer 清状态）。 */
  onCollapse?: () => void;
}

export interface InputOverlayHandle {
  expand: () => void;
  collapse: () => void;
  isLarge: () => boolean;
  toggle: () => void;
  destroy: () => void;
}

const LARGE_CLASS = "fn-input-large";
const BACKDROP_CLASS = "fn-input-overlay-backdrop";

export function mountInputOverlay(opts: InputOverlayOptions): InputOverlayHandle {
  const { host, getView, onCollapse } = opts;
  let backdrop: HTMLElement | null = null;
  let large = false;

  function ensureBackdrop(): HTMLElement {
    if (!backdrop) {
      const el = document.createElement("div");
      el.className = BACKDROP_CLASS;
      el.hidden = true;
      el.addEventListener("mousedown", (e) => {
        // 点遮罩收回（不抢编辑器焦点内的点击）
        e.preventDefault();
        collapse();
      });
      document.body.appendChild(el);
      backdrop = el;
    }
    return backdrop;
  }

  function expand(): void {
    if (large) return;
    large = true;
    host.classList.add(LARGE_CLASS);
    const bd = ensureBackdrop();
    bd.hidden = false;
    requestAnimationFrame(() => {
      const v = getView();
      v?.requestMeasure();
      v?.focus();
    });
  }

  function collapse(): void {
    if (!large) return;
    large = false;
    host.classList.remove(LARGE_CLASS);
    if (backdrop) backdrop.hidden = true;
    requestAnimationFrame(() => {
      const v = getView();
      v?.requestMeasure();
      v?.focus();
    });
    onCollapse?.();
  }

  function isLarge(): boolean {
    return large;
  }

  function toggle(): void {
    large ? collapse() : expand();
  }

  function destroy(): void {
    host.classList.remove(LARGE_CLASS);
    backdrop?.remove();
    backdrop = null;
    large = false;
  }

  return { expand, collapse, isLarge, toggle, destroy };
}
