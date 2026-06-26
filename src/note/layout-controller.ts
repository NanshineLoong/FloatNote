import { computeLayout, DEFAULT_PREFS, type Layout, type Mode } from "./layout";

/**
 * 把 `computeLayout` 的结果落地到 DOM：写 CSS 变量（左边距/正文宽/右边距/助手宽）、
 * 切 `mode-inline | mode-floating | mode-closed` 类。
 *
 * 助手永远活在笔记窗内（无独立窗）：inline 时占右边距一栏，floating 时浮成角落小人。
 * 几何只由窗口宽度的单一连续函数决定，故 inline↔floating 不产生瞬跳。
 *
 * 监听窗口尺寸由调用方接线（resize → `apply`）。开关也由调用方驱动。
 */
export interface LayoutController {
  /** 按当前窗口宽度重算并落地。 */
  apply: () => void;
  /** 开/关整个助手。 */
  setOpen: (open: boolean) => void;
}

export function createLayoutController(
  app: HTMLElement,
  init: { open: boolean },
): LayoutController {
  let open = init.open;

  function apply() {
    const prefs = { ...DEFAULT_PREFS, open };
    const layout: Layout = computeLayout(window.innerWidth, prefs);

    app.style.setProperty("--left", `${layout.leftMargin}px`);
    app.style.setProperty("--text", `${layout.textWidth}px`);
    app.style.setProperty("--right", `${layout.rightMargin}px`);
    app.style.setProperty("--assist", `${layout.assistantWidth}px`);

    // 小人收起态横坐标（连续函数，inline/floating 共用）。
    app.style.setProperty("--bot-x", `${layout.botX}px`);
    // 展开态钳左：小人若贴在窗口右缘、右侧塞不下输入框，就左移腾位（floating 形态用）。
    const botXOpen = Math.min(
      layout.botX,
      window.innerWidth - prefs.botInset - prefs.botW - prefs.inputReserve,
    );
    app.style.setProperty("--bot-x-open", `${botXOpen}px`);

    setMode(app, layout.mode);
  }

  return {
    apply,
    setOpen(value) {
      open = value;
      apply();
    },
  };
}

function setMode(app: HTMLElement, mode: Mode) {
  app.classList.toggle("mode-inline", mode === "inline");
  app.classList.toggle("mode-floating", mode === "floating");
  app.classList.toggle("mode-closed", mode === "closed");
}
