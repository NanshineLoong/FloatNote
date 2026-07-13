import { describe, expect, it } from "vitest";
import { createVersionPreviewState } from "./version-preview";

describe("version preview state", () => {
  it("keeps the live editor content while browsing multiple versions", () => {
    const preview = createVersionPreviewState();
    preview.begin("current draft");
    preview.begin("historical content shown in the editor");

    expect(preview.contentForRestore("another historical version")).toBe("current draft");
    expect(preview.exit()).toBe("current draft");
    expect(preview.active).toBe(false);
  });

  it("clears preview state after a successful restore without replaying old content", () => {
    const preview = createVersionPreviewState();
    preview.begin("current draft");

    preview.completeRestore();

    expect(preview.active).toBe(false);
    expect(preview.exit()).toBeNull();
  });
});
