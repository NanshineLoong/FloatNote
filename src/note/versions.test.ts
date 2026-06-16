import { describe, expect, it } from "vitest";
import { formatVersionLabel, type VersionEntry } from "./versions";

describe("formatVersionLabel", () => {
  it("formats version number and short time", () => {
    const entry: VersionEntry = { v: 3, ts: "2026-06-16T10:42:00+08:00", source: "ai", summary: null };
    expect(formatVersionLabel(entry)).toBe("v3 · AI · 10:42");
  });

  it("labels manual snapshots", () => {
    const entry: VersionEntry = { v: 1, ts: "2026-06-16T09:05:00+08:00", source: "manual", summary: null };
    expect(formatVersionLabel(entry)).toBe("v1 · 手动 · 09:05");
  });
});
