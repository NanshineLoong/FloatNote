/**
 * 笔记窗内部的响应式分级收缩布局（纯逻辑，便于 Vitest 测）。
 *
 * 把笔记窗内容区从左到右看成 `[左边距] [正文列] [右边距]`，助手活在右边距里。
 * 随内容宽度变化，分级收缩：**先压左边距 → 再压右边距/助手 → 最后压正文**。
 *
 * 助手「在窗口内右边距」还是「弹出为窗口外独立窗」，由右边距能否容下助手决定：
 * - 宽区（右边距 ≥ 助手理想宽）：强制 embedded。
 * - 重叠区（助手最小宽 ≤ 右边距 < 理想宽）：粘性沿用用户偏好，可手动切换。
 * - 窄区（右边距 < 助手最小宽）：强制 detached，窗口里不留助手位。
 */

export interface LayoutPrefs {
  /** 正文理想（最大）宽。 */
  textPref: number;
  /** 无助手时正文与窗口边的最小边距。 */
  pad: number;
  /** 助手理想（最大）宽。 */
  assistPref: number;
  /** 助手可接受的最小宽（再窄就弹出独立窗）。 */
  assistMin: number;
  /** 正文与助手之间的间隙。 */
  gap: number;
  /** 助手是否展开（关闭则布局里完全没有助手）。 */
  open: boolean;
  /** 重叠区里的用户粘性偏好。 */
  sticky: "embedded" | "detached";
}

export type Placement = "embedded" | "detached" | "hidden";
export type Zone = "wide" | "overlap" | "narrow" | "closed";

export interface Layout {
  /** 正文左侧空白宽（px）。 */
  leftMargin: number;
  /** 正文列宽（px）。 */
  textWidth: number;
  /** 正文右侧到窗口右缘的整块宽（px）；embedded 时含间隙 + 助手。 */
  rightMargin: number;
  /** 助手列宽（px）；仅 embedded 有意义，否则为 0。 */
  assistantWidth: number;
  placement: Placement;
  zone: Zone;
  /** 是否处于可手动切换嵌入/分离的重叠区。 */
  canToggle: boolean;
}

export const DEFAULT_PREFS: Omit<LayoutPrefs, "open" | "sticky"> = {
  textPref: 640,
  pad: 28,
  assistPref: 340,
  assistMin: 280,
  gap: 24,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** 关闭或分离时，窗口内只剩居中正文（无助手列）。 */
function textOnly(width: number, prefs: LayoutPrefs, placement: Placement, zone: Zone): Layout {
  const textWidth = Math.min(prefs.textPref, Math.max(0, width - 2 * prefs.pad));
  const margin = Math.max(prefs.pad, (width - textWidth) / 2);
  return {
    leftMargin: margin,
    textWidth,
    rightMargin: margin,
    assistantWidth: 0,
    placement,
    zone,
    canToggle: zone === "overlap",
  };
}

/**
 * 计算给定内容宽度下的布局与助手位置。
 *
 * @param width 笔记窗内容区宽度（px，逻辑像素）。
 */
export function computeLayout(width: number, prefs: LayoutPrefs): Layout {
  const { textPref, pad, assistPref, assistMin, gap } = prefs;

  if (!prefs.open) {
    return textOnly(width, prefs, "hidden", "closed");
  }

  // 区间边界（以内容宽度 width 表示）。
  const wideMin = pad + textPref + gap + assistPref; // ≥ 此值：右边距能容下理想宽助手
  const overlapMin = pad + textPref + gap + assistMin; // ≥ 此值：至少能容下最小宽助手

  let zone: Zone;
  if (width >= wideMin) zone = "wide";
  else if (width >= overlapMin) zone = "overlap";
  else zone = "narrow";

  const placement: Placement =
    zone === "wide" ? "embedded" : zone === "narrow" ? "detached" : prefs.sticky;

  if (placement === "detached") {
    // 助手在窗口外，窗口内只剩居中正文。
    return textOnly(width, prefs, "detached", zone);
  }

  // —— embedded：正文固定 textPref，分级收缩左边距 → 助手宽 ——
  const textWidth = textPref;
  // 助手宽在 [assistMin, assistPref] 间，由可用空间决定。
  const assistantWidth = clamp(width - pad - textWidth - gap, assistMin, assistPref);
  const rightRegionBase = gap + assistPref; // 右边距的「舒适」基准

  let leftMargin: number;
  let rightMargin: number;
  const symmetricMin = textPref + 2 * rightRegionBase; // 此宽以上左右边距相等同步增长
  if (width >= symmetricMin) {
    const extra = (width - symmetricMin) / 2;
    leftMargin = rightRegionBase + extra;
    rightMargin = rightRegionBase + extra;
  } else {
    // 收缩阶段：右边距取实际占用，左边距吃掉其余（先压左）。
    rightMargin = gap + assistantWidth;
    leftMargin = Math.max(pad, width - textWidth - rightMargin);
  }

  return {
    leftMargin,
    textWidth,
    rightMargin,
    assistantWidth,
    placement: "embedded",
    zone,
    canToggle: zone === "overlap",
  };
}
