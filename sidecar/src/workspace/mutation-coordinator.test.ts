import { describe, expect, it, vi } from "vitest";
import type { WorkspaceClient } from "./types.js";
import { MutationCoordinator } from "./mutation-coordinator.js";

function workspace(content = "before") {
  return {
    readRawProject: vi.fn().mockResolvedValue(content),
    listEntries: vi.fn().mockResolvedValue([{ path: "piece.md", kind: "piece" }]),
  } as unknown as WorkspaceClient;
}

function dependencies() {
  return {
    workspace: workspace(),
    review: vi.fn().mockResolvedValue({
      allowed: true,
      lease: "lease-1",
      writeMode: "direct" as const,
    }),
    commit: vi.fn().mockResolvedValue({ ok: true, version: 3 }),
  };
}

describe("MutationCoordinator", () => {
  it("prepares during tool_call and commits exactly once during execute", async () => {
    const deps = dependencies();
    const coordinator = new MutationCoordinator(deps);

    await expect(coordinator.prepareForHook("tool-1", "edit", {
      path: "piece.md",
      edits: [{ oldText: "before", newText: "after" }],
    })).resolves.toBeUndefined();
    expect(deps.review).toHaveBeenCalledTimes(1);
    expect(deps.review).toHaveBeenCalledWith(
      "tool-1",
      "edit",
      expect.objectContaining({ oldContent: "before", newContent: "after" }),
    );

    await expect(coordinator.commitForTool("tool-1")).resolves.toMatchObject({ ok: true, version: 3 });
    await expect(coordinator.commitForTool("tool-1")).rejects.toThrow("没有可用的写入许可");
    expect(deps.commit).toHaveBeenCalledTimes(1);
  });

  it("blocks a denied review and never commits", async () => {
    const deps = dependencies();
    deps.review.mockResolvedValue({ allowed: false });
    const coordinator = new MutationCoordinator(deps);

    await expect(coordinator.prepareForHook("tool-1", "write", {
      path: "piece.md",
      content: "replacement",
    })).rejects.toThrow("用户拒绝");
    await expect(coordinator.commitForTool("tool-1")).rejects.toThrow("没有可用的写入许可");
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it("does not retain an approval without a lease", async () => {
    const deps = dependencies();
    deps.review.mockResolvedValue({ allowed: true });
    const coordinator = new MutationCoordinator(deps);

    await expect(coordinator.prepareForHook("tool-1", "write", {
      path: "piece.md",
      content: "replacement",
    })).rejects.toThrow("写入许可");
    expect(deps.commit).not.toHaveBeenCalled();
  });
});
