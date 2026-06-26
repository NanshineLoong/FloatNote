import { computeLayout, DEFAULT_PREFS, type Layout, type Mode } from "./layout";
import { canSplit, computeSplitLayout } from "./split";

/**
 * 把布局结果落地到 DOM：写 CSS 变量、切 mode 类。
 *
 * 单栏：复用 `computeLayout` 的单一连续曲线（助手 inline / floating / closed）。
 * 分屏（够宽 + 已请求）：切到 `computeSplitLayout`（[左][Inbox][gap][成品][右]），
 * 右槽换成成品栏，助手被强制 floating——零新增几何，只是渲染方式切换。
 *
 * 监听窗口尺寸由调用方接线（resize → `apply`）。开关 / 分屏请求也由调用方驱动。
 */
export interface LayoutController {
  /** 按当前窗口宽度重算并落地。 */
  apply: () => void;
  /** 开/关整个助手。 */
  setOpen: (open: boolean) => void;
  /** 请求/取消分屏（仅在窗口够宽时实际生效）。 */
  setSplit: (split: boolean) => void;
  /** 当前是否真正处于分屏（够宽 + 已请求）。供调用方决定成品栏归属。 */
  isSplit: () => boolean;
}

export function createLayoutController(
  app: HTMLElement,
  init: { open: boolean },
): LayoutController {
  let open = init.open;
  let splitRequested = false;
  let splitActive = false;

  function apply() {
    const width = window.innerWidth;
    splitActive = splitRequested && canSplit(width);

    if (splitActive) {
      applySplit(width);
    } else {
      applySingle(width);
    }
    app.classList.toggle("split-active", splitActive);
  }

  function applySingle(width: number) {
    const prefs = { ...DEFAULT_PREFS, open };
    const layout: Layout = computeLayout(width, prefs);
    app.style.setProperty("--left", `${layout.leftMargin}px`);
    app.style.setProperty("--text", `${layout.textWidth}px`);
    app.style.setProperty("--right", `${layout.rightMargin}px`);
    app.style.setProperty("--assist", `${layout.assistantWidth}px`);
    app.style.setProperty("--bot-x", `${layout.botX}px`);
    const botXOpen = Math.min(
      layout.botX,
      width - prefs.botInset - prefs.botW - prefs.inputReserve,
    );
    app.style.setProperty("--bot-x-open", `${botXOpen}px`);
    setMode(app, layout.mode);
  }

  function applySplit(width: number) {
    const s = computeSplitLayout(width);
    app.style.setProperty("--left", `${s.leftMargin}px`);
    app.style.setProperty("--text", `${s.inboxWidth}px`);
    app.style.setProperty("--split-gap", `${s.gap}px`);
    app.style.setProperty("--piece", `${s.pieceWidth}px`);
    app.style.setProperty("--right", `${s.rightMargin}px`);
    // 助手强制 floating：贴窗口右下，随右缘走。closed 时不显示。
    const prefs = { ...DEFAULT_PREFS, open };
    const botX = width - prefs.botInset - prefs.botW;
    app.style.setProperty("--bot-x", `${botX}px`);
    app.style.setProperty(
      "--bot-x-open",
      `${Math.min(botX, width - prefs.botInset - prefs.botW - prefs.inputReserve)}px`,
    );
    setMode(app, open ? "floating" : "closed");
  }

  return {
    apply,
    setOpen(value) {
      open = value;
      apply();
    },
    setSplit(value) {
      splitRequested = value;
      apply();
    },
    isSplit() {
      return splitActive;
    },
  };
}

function setMode(app: HTMLElement, mode: Mode) {
  app.classList.toggle("mode-inline", mode === "inline");
  app.classList.toggle("mode-floating", mode === "floating");
  app.classList.toggle("mode-closed", mode === "closed");
}
