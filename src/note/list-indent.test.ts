import { describe, expect, it } from "vitest";
import {
  canDemote,
  indentLine,
  isListItemLine,
  lineDepth,
  outdentLine,
  prevListItemDepth,
} from "./list-indent";

describe("isListItemLine", () => {
  it("matches unordered and ordered markers", () => {
    expect(isListItemLine("- a")).toBe(true);
    expect(isListItemLine("* a")).toBe(true);
    expect(isListItemLine("+ a")).toBe(true);
    expect(isListItemLine("1. a")).toBe(true);
    expect(isListItemLine("  - a")).toBe(true);
  });
  it("rejects plain and empty lines", () => {
    expect(isListItemLine("plain")).toBe(false);
    expect(isListItemLine("")).toBe(false);
    expect(isListItemLine("    ")).toBe(false);
  });
});

describe("lineDepth", () => {
  it("counts 4 spaces per level", () => {
    expect(lineDepth("- a")).toBe(0);
    expect(lineDepth("    - a")).toBe(1);
    expect(lineDepth("        - a")).toBe(2);
  });
  it("floors sub-level indent", () => {
    expect(lineDepth("  - a")).toBe(0);
  });
});

describe("indentLine / outdentLine", () => {
  it("indent adds 4 spaces", () => {
    expect(indentLine("- a")).toBe("    - a");
  });
  it("outdent removes up to 4 leading spaces", () => {
    expect(outdentLine("    - a")).toBe("- a");
    expect(outdentLine("        - a")).toBe("    - a");
  });
  it("outdent removes a tab too", () => {
    expect(outdentLine("\t- a")).toBe("- a");
  });
  it("outdent on no leading whitespace is a no-op", () => {
    expect(outdentLine("- a")).toBe("- a");
  });
  it("outdent removes only what is there", () => {
    expect(outdentLine("  - a")).toBe("- a");
  });
});

describe("canDemote", () => {
  it("allows when current is at or above previous", () => {
    expect(canDemote(0, 0)).toBe(true);
    expect(canDemote(1, 1)).toBe(true);
    expect(canDemote(2, 1)).toBe(true);
  });
  it("forbids when already one level below previous", () => {
    expect(canDemote(0, 1)).toBe(false);
    expect(canDemote(1, 2)).toBe(false);
  });
  it("forbids the first item (no previous)", () => {
    expect(canDemote(null, 0)).toBe(false);
  });
});

describe("prevListItemDepth", () => {
  const lines = ["- a", "    - b", "- c", "", "- d"];
  it("returns the previous list line's depth", () => {
    expect(prevListItemDepth(lines, 1)).toBe(0); // prev "- a" depth 0
    expect(prevListItemDepth(lines, 2)).toBe(1); // prev "    - b" depth 1
  });
  it("skips a blank line", () => {
    expect(prevListItemDepth(lines, 4)).toBe(0); // prev (skip blank) "- c" depth 0
  });
  it("returns null when a non-list non-blank line blocks", () => {
    expect(prevListItemDepth(["plain", "- a"], 1)).toBe(null);
  });
  it("returns null at the top", () => {
    expect(prevListItemDepth(["- a"], 0)).toBe(null);
  });
});
