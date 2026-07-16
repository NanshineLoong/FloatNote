import { describe, expect, it } from "vitest";
import { normalizeWorkspaceRoot, validateProjectPath } from "./path-policy.js";

describe("workspace path policy", () => {
  it("accepts only root selectors and listed flat Markdown notes", () => {
    expect(normalizeWorkspaceRoot(undefined)).toBe(".");
    expect(normalizeWorkspaceRoot(".")).toBe(".");
    expect(validateProjectPath("Ideas.md", ["_inbox.md", "Ideas.md"])).toBe("Ideas.md");
  });

  it("rejects traversal, absolute paths, backslashes, and unlisted files", () => {
    for (const candidate of ["../secret.md", "/tmp/a.md", "nested/a.md", "nested\\a.md", "C:\\temp\\a.md"]) {
      expect(() => validateProjectPath(candidate, ["Ideas.md"])).toThrow("当前项目");
    }
    expect(() => validateProjectPath("_private.md", ["Ideas.md"])).toThrow("当前项目");
  });
});
