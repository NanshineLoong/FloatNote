import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  inboxPath,
  inboxEntry,
  scheduleSave,
  saveImmediate,
  flushAll,
  isDirty,
  onConflict,
  discardPending,
  __resetSaveStateForTests,
} from "./notes-state";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const okWrite = (mtime: number | null = null) => ({ conflict: false, mtime });

describe("inboxPath", () => {
  it("joins a POSIX project folder with _inbox.md", () => {
    expect(inboxPath("/Users/me/FloatNote/阅读笔记")).toBe(
      "/Users/me/FloatNote/阅读笔记/_inbox.md",
    );
  });

  it("joins a Windows project folder with a backslash", () => {
    expect(inboxPath("C:\\Users\\me\\FloatNote\\阅读笔记")).toBe(
      "C:\\Users\\me\\FloatNote\\阅读笔记\\_inbox.md",
    );
  });

  it("strips a trailing separator before joining", () => {
    expect(inboxPath("/Users/me/proj/")).toBe("/Users/me/proj/_inbox.md");
  });
});

describe("inboxEntry", () => {
  it("names the entry _inbox and points at the inbox file", () => {
    const entry = inboxEntry({ name: "阅读笔记", path: "/Users/me/proj" });
    expect(entry).toEqual({ name: "_inbox", path: "/Users/me/proj/_inbox.md" });
  });
});

describe("save scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedInvoke.mockReset();
    __resetSaveStateForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps per-path timers independent (regression: switching files no longer drops the first file)", async () => {
    mockedInvoke.mockResolvedValue(okWrite(1000));
    scheduleSave("/a.md", "A1");
    await vi.advanceTimersByTimeAsync(100);
    scheduleSave("/b.md", "B1");
    await vi.advanceTimersByTimeAsync(400); // A 的 500ms 到
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "A1",
      expectedMtime: null,
    });
    expect(isDirty("/a.md")).toBe(false);
    expect(isDirty("/b.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(100); // B 的 500ms 到
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/b.md",
      content: "B1",
      expectedMtime: null,
    });
    expect(isDirty("/b.md")).toBe(false);
  });

  it("coalesces rapid edits on the same path to the last content", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "v1");
    await vi.advanceTimersByTimeAsync(150);
    scheduleSave("/a.md", "v2");
    await vi.advanceTimersByTimeAsync(150);
    scheduleSave("/a.md", "v3");
    await vi.advanceTimersByTimeAsync(500);
    const calls = mockedInvoke.mock.calls.filter((c) => c[0] === "write_note");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ path: "/a.md", content: "v3" });
  });

  it("retries on io error with backoff and clears pending on eventual success", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("io")).mockResolvedValueOnce(okWrite(2000));
    scheduleSave("/a.md", "x");
    await vi.advanceTimersByTimeAsync(500); // 首次失败
    expect(isDirty("/a.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(500); // 退避 1 后成功
    expect(isDirty("/a.md")).toBe(false);
  });

  it("saveImmediate writes without waiting for the debounce timer", async () => {
    mockedInvoke.mockResolvedValue(okWrite(3000));
    await saveImmediate("/a.md", "now");
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "now",
      expectedMtime: null,
    });
    expect(isDirty("/a.md")).toBe(false);
  });

  it("flushAll flushes every pending path immediately", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "A");
    scheduleSave("/b.md", "B");
    flushAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "A",
      expectedMtime: null,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/b.md",
      content: "B",
      expectedMtime: null,
    });
  });

  it("onConflict handler is called and pending retained when write reports conflict", async () => {
    mockedInvoke.mockResolvedValue({ conflict: true, mtime: null });
    const handler = vi.fn();
    onConflict(handler);
    scheduleSave("/a.md", "local");
    await vi.advanceTimersByTimeAsync(500);
    expect(handler).toHaveBeenCalledWith("/a.md", "local");
    expect(isDirty("/a.md")).toBe(true);
  });

  it("discardPending clears a path's pending state", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "x");
    discardPending("/a.md");
    expect(isDirty("/a.md")).toBe(false);
  });
});
