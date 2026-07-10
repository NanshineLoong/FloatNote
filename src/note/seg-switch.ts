/**
 * 三段滑拨杆的纯逻辑（无 DOM）：采集(0) ｜ 写作(1) ｜ 双栏(2)。
 * reach 决定双栏是否可达；窄窗（放不下两栏）时钮最多拨到写作(1)。
 * 与 topbar.ts 解耦，便于单测映射与窄窗约束。
 */
import type { ViewSeg } from "./topbar";

export type SegIdx = 0 | 1 | 2;
export type Reach = "full" | "narrow";

const ORDER: readonly ViewSeg[] = ["inbox", "piece", "split"] as const;

export function viewToIdx(view: ViewSeg): SegIdx {
  return ORDER.indexOf(view) as SegIdx;
}

/** 窄窗（放不下两栏）时双栏不可达，钮最多拨到写作(1)。 */
export function maxReachableIdx(reach: Reach): SegIdx {
  return reach === "narrow" ? 1 : 2;
}
