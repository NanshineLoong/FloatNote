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
  /** 开/关助手内容（小人 / 对话）。 */
  setAssistantOpen: (open: boolean) => void;
  /** 开/关行动面板。与助手同等地「占用右栏」。 */
  setActionOpen: (open: boolean) => void;
  /** 请求/取消分屏（仅在窗口够宽时实际生效）。 */
  setSplit: (split: boolean) => void;
  /** 当前是否真正处于分屏（够宽 + 已请求）。供调用方决定成品栏归属。 */
  isSplit: () => boolean;
}

export function createLayoutController(
  app: HTMLElement,
  init: { assistantOpen: boolean },
): LayoutController {
  let assistantOpen = init.assistantOpen;
  let actionOpen = false;
  let splitRequested = false;
  let splitActive = false;

  // 右栏几何（正文左推 / 预留列宽 / inline 态）由助手或行动「任一」打开驱动 ——
  // 二者是同等的「占用右栏」行为，故 layout 的 open 取二者之或。
  const railOpen = () => assistantOpen || actionOpen;

  function apply() {
    const width = window.innerWidth;
    splitActive = splitRequested && canSplit(width);

    if (splitActive) {
      applySplit(width);
    } else {
      applySingle(width);
    }
    app.classList.toggle("split-active", splitActive);
    // 助手内容是否显示，与「右栏是否打开」解耦：只看助手自身开关。
    app.classList.toggle("assistant-on", assistantOpen);
  }

  function applySingle(width: number) {
    const prefs = { ...DEFAULT_PREFS, open: railOpen() };
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
    // 助手/行动强制 floating：贴窗口右下/右上，随右缘走。都没开时 closed。
    const prefs = { ...DEFAULT_PREFS, open: railOpen() };
    const botX = width - prefs.botInset - prefs.botW;
    app.style.setProperty("--bot-x", `${botX}px`);
    app.style.setProperty(
      "--bot-x-open",
      `${Math.min(botX, width - prefs.botInset - prefs.botW - prefs.inputReserve)}px`,
    );
    setMode(app, railOpen() ? "floating" : "closed");
  }

  return {
    apply,
    setAssistantOpen(value) {
      assistantOpen = value;
      apply();
    },
    setActionOpen(value) {
      actionOpen = value;
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
