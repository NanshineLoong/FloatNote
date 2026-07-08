import { describe, it, expect } from "vitest";
import { actionTargetForTransition } from "./tasks-panel";

describe("actionTargetForTransition", () => {
  it("项目→文档：记下当前开关并关掉面板", () => {
    // 行动开着进文档 → 记下 true、目标关。
    expect(
      actionTargetForTransition({ from: "project", to: "document", currentOpen: true, rememberedOpen: false }),
    ).toEqual({ open: false, remember: true });
    // 行动关着进文档 → 记下 false、目标仍关。
    expect(
      actionTargetForTransition({ from: "project", to: "document", currentOpen: false, rememberedOpen: false }),
    ).toEqual({ open: false, remember: false });
  });

  it("文档→项目：按离开项目时记下的开关恢复", () => {
    // 离开时开着 → 恢复开。
    expect(
      actionTargetForTransition({ from: "document", to: "project", currentOpen: false, rememberedOpen: true }),
    ).toEqual({ open: true, remember: null });
    // 离开时关着 → 保持关。
    expect(
      actionTargetForTransition({ from: "document", to: "project", currentOpen: false, rememberedOpen: false }),
    ).toEqual({ open: false, remember: null });
  });

  it("文档→项目：不依赖文档模式期间面板的临时开关（仅看记忆值）", () => {
    // 即使文档期间面板被意外设为开，恢复仍只看 rememberedOpen。
    expect(
      actionTargetForTransition({ from: "document", to: "project", currentOpen: true, rememberedOpen: false }),
    ).toEqual({ open: false, remember: null });
  });

  it("项目→项目：保持原样、不触碰记忆", () => {
    expect(
      actionTargetForTransition({ from: "project", to: "project", currentOpen: true, rememberedOpen: false }),
    ).toEqual({ open: true, remember: null });
    expect(
      actionTargetForTransition({ from: "project", to: "project", currentOpen: false, rememberedOpen: false }),
    ).toEqual({ open: false, remember: null });
  });

  it("文档→文档：保持原样、不触碰记忆", () => {
    expect(
      actionTargetForTransition({ from: "document", to: "document", currentOpen: false, rememberedOpen: true }),
    ).toEqual({ open: false, remember: null });
  });
});
