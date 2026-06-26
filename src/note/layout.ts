/**
 * 笔记窗内部的响应式布局（纯逻辑，便于 Vitest 测）。
 *
 * 把内容区从左到右看成 `[左边距] [正文列] [右边距]`，助手住在右边距里。
 * 核心约束：**正文宽恒为理想宽（textPref），从不为助手「让位」收窄**——助手只是
 * 占用本就存在的右边距。随窗口由大到小，沿一条**单一连续曲线**收缩：
 *
 *   ① 对称：很宽，左右边距相等且大，助手嵌在右边距（assistPref）。
 *   ② 压左：右边距稳定够放助手，左边距吃掉收缩（→ pad）。
 *   ③ 压右：左边距到 pad 后，右边距连同助手一起收缩（assistPref → assistMin）。
 *   ④ floating：右边距放不下助手，助手**浮起**为右下角小人/浮层（不占布局），
 *      正文仍 textPref、靠左；窗口极窄时正文才被动收缩、居中。
 *
 * ③→④ 交界处 `leftMargin / textWidth / rightMargin` 三者数值连续，唯一变化是助手
 * 从「右边距里的一栏」抬成「浮在右边距上的覆盖物」——几何零跳变，只是渲染方式切换。
 */

export interface LayoutPrefs {
  /** 正文理想（且恒定）宽。 */
  textPref: number;
  /** 正文与窗口边的最小边距。 */
  pad: number;
  /** 助手理想（最大）宽。 */
  assistPref: number;
  /** 助手可接受的最小宽（再窄就浮起）。 */
  assistMin: number;
  /** 正文与助手之间的间隙。 */
  gap: number;
  /** 小人（机器人按钮）宽，用于「跟随右缘」锚点。 */
  botW: number;
  /** followX 内缩：含 dock 左内边距(14)，使渲染出的小人右缘距窗口右缘约 16px。 */
  botInset: number;
  /** 输入框展开时需要在小人右侧预留的横向空间（floating 钳左用）。 */
  inputReserve: number;
  /** 助手是否展开（关闭则布局里完全没有助手）。 */
  open: boolean;
}

export type Mode = "closed" | "inline" | "floating";

export interface Layout {
  /** 正文左侧空白宽（px）。 */
  leftMargin: number;
  /** 正文列宽（px）。 */
  textWidth: number;
  /** 正文右侧到窗口右缘的整块宽（px）；inline 时含间隙 + 助手。 */
  rightMargin: number;
  /** 助手列宽（px）；仅 inline 有意义，floating/closed 为 0。 */
  assistantWidth: number;
  /**
   * 小人横坐标（px，相对内容区左缘，收起态）。窗口宽度的**单一连续函数**：
   * 窄时贴窗口右缘（followX），宽到 followX 越过「正文右缘 + 间隙」后停在那里（stopX），
   * 再宽只让右间距继续涨——inline/floating 共用同一坐标，故模式切换时小人零跳变。
   */
  botX: number;
  mode: Mode;
}

export const DEFAULT_PREFS: Omit<LayoutPrefs, "open"> = {
  textPref: 720,
  pad: 28,
  assistPref: 340,
  assistMin: 280,
  gap: 24,
  botW: 46,
  botInset: 30,
  // floating 展开时小人左移量 ≈ 此值；与 CSS 里 floating 输入框宽(240)+间隙(10)对齐，
  // 太大则小人滑进正文中央——见 styles.css 的 `.assistant-input-wrap.open`（floating）。
  inputReserve: 250,
};

type Geometry = Omit<Layout, "botX">;

/** 关闭或浮起时，窗口内只剩居中正文（无助手列）。 */
function textOnly(width: number, prefs: LayoutPrefs, mode: Mode): Geometry {
  const textWidth = Math.min(prefs.textPref, Math.max(0, width - 2 * prefs.pad));
  const margin = Math.max(prefs.pad, (width - textWidth) / 2);
  return { leftMargin: margin, textWidth, rightMargin: margin, assistantWidth: 0, mode };
}

/**
 * 计算给定内容宽度下的布局与助手渲染态。
 *
 * @param width 笔记窗内容区宽度（px，逻辑像素）。
 */
export function computeLayout(width: number, prefs: LayoutPrefs): Layout {
  const geo = computeGeometry(width, prefs);
  // 小人横坐标：min(跟随右缘, 停靠正文右侧)。两段都是 width 的连续函数，取 min 仍连续。
  const stopX = geo.leftMargin + geo.textWidth + prefs.gap;
  const followX = width - prefs.botInset - prefs.botW;
  return { ...geo, botX: Math.min(followX, stopX) };
}

function computeGeometry(width: number, prefs: LayoutPrefs): Geometry {
  const { textPref, pad, assistPref, assistMin, gap } = prefs;

  if (!prefs.open) {
    return textOnly(width, prefs, "closed");
  }

  const rPref = gap + assistPref; // 右边距「舒适」基准（助手满宽）
  const rMin = gap + assistMin; // 助手仍能 inline 的最小右边距

  // 区间边界（以内容宽度 width 表示）。
  const symmetricMin = textPref + 2 * rPref; // ≥：左右边距相等同步增长
  const pressLeftMin = textPref + rPref + pad; // ≥：右边距=rPref，压左
  const pressRightMin = textPref + rMin + pad; // ≥：左边距=pad，压右（助手仍 inline）

  if (width >= symmetricMin) {
    // ① 对称：左右边距相等。
    const margin = (width - textPref) / 2;
    return {
      leftMargin: margin,
      textWidth: textPref,
      rightMargin: margin,
      assistantWidth: assistPref,
      mode: "inline",
    };
  }

  if (width >= pressLeftMin) {
    // ② 压左：右边距固定 rPref，左边距吃掉收缩。
    return {
      leftMargin: width - textPref - rPref,
      textWidth: textPref,
      rightMargin: rPref,
      assistantWidth: assistPref,
      mode: "inline",
    };
  }

  if (width >= pressRightMin) {
    // ③ 压右：左边距=pad，右边距连同助手一起收缩。
    const rightMargin = width - textPref - pad;
    return {
      leftMargin: pad,
      textWidth: textPref,
      rightMargin,
      assistantWidth: rightMargin - gap,
      mode: "inline",
    };
  }

  // ④ floating：助手浮起，不占布局。正文仍靠左、恒 textPref，直到窗口窄到放不下。
  if (width >= textPref + 2 * pad) {
    return {
      leftMargin: pad,
      textWidth: textPref,
      rightMargin: width - textPref - pad,
      assistantWidth: 0,
      mode: "floating",
    };
  }

  // 极窄：正文被动收缩、居中。
  return textOnly(width, prefs, "floating");
}
