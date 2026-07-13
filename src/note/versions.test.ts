import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteVersion,
  formatVersionEntry,
  readVersion,
  renameVersion,
  restoreVersion,
  type VersionEntry,
} from "./versions";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => invokeMock.mockReset());

describe("formatVersionEntry", () => {
  it("uses the custom name and keeps AI in the secondary metadata", () => {
    const entry: VersionEntry = { v: 3, ts: "2026-06-16T10:42:00+08:00", source: "ai", summary: null };
    entry.summary = "完成第一稿";
    expect(formatVersionEntry(entry, 2026, "Asia/Shanghai")).toEqual({
      title: "完成第一稿",
      meta: "6月16日 10:42 · AI",
    });
  });

  it("uses a default version name and omits the manual source label", () => {
    const entry: VersionEntry = { v: 1, ts: "2026-06-16T09:05:00+08:00", source: "manual", summary: null };
    expect(formatVersionEntry(entry, 2026, "Asia/Shanghai")).toEqual({
      title: "版本 1",
      meta: "6月16日 09:05",
    });
  });

  it("includes the year for versions outside the current year", () => {
    const entry: VersionEntry = { v: 8, ts: "2025-12-01T07:09:00Z", source: "restore", summary: "恢复前备份" };
    expect(formatVersionEntry(entry, 2026, "Asia/Shanghai")).toEqual({
      title: "恢复前备份",
      meta: "2025年12月1日 15:09",
    });
  });
});

describe("version commands", () => {
  it("reads a version without restoring it", async () => {
    invokeMock.mockResolvedValueOnce("older content");
    await expect(readVersion("/notes", "piece", 4)).resolves.toBe("older content");
    expect(invokeMock).toHaveBeenCalledWith("read_version", { dir: "/notes", noteId: "piece", v: 4 });
  });

  it("renames and deletes a selected version", async () => {
    invokeMock.mockResolvedValue(undefined);
    await renameVersion("/notes", "piece", 4, "完成第一稿");
    await deleteVersion("/notes", "piece", 4);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "rename_version", {
      dir: "/notes", noteId: "piece", v: 4, name: "完成第一稿",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "delete_version", {
      dir: "/notes", noteId: "piece", v: 4,
    });
  });

  it("restores with an mtime guard and returns the new disk mtime", async () => {
    invokeMock.mockResolvedValueOnce({ content: "older content", mtime: 51 });
    await expect(restoreVersion(
      "/notes",
      "piece",
      "/notes/piece.md",
      "current content",
      4,
      50,
    )).resolves.toEqual({ content: "older content", mtime: 51 });
    expect(invokeMock).toHaveBeenCalledWith("restore_version", {
      dir: "/notes",
      noteId: "piece",
      path: "/notes/piece.md",
      currentContent: "current content",
      v: 4,
      expectedMtime: 50,
    });
  });
});
