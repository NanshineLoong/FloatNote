import { describe, expect, it } from "vitest";
import { parentDir, pushRecent, removeFromRecent, RECENT_LIMIT } from "./recent-projects";

describe("pushRecent", () => {
  it("prepends a new path", () => {
    expect(pushRecent(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("moves an existing path to the front without duplicating", () => {
    expect(pushRecent(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("caps the list to the limit, dropping the oldest", () => {
    const list = ["/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8"];
    const next = pushRecent(list, "/new");
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next[0]).toBe("/new");
    expect(next).not.toContain("/8");
  });

  it("does not mutate the input", () => {
    const list = ["/a"];
    pushRecent(list, "/b");
    expect(list).toEqual(["/a"]);
  });
});

describe("parentDir", () => {
  it("returns the POSIX parent", () => {
    expect(parentDir("/home/me/Notes/proj")).toBe("/home/me/Notes");
  });

  it("ignores a trailing slash", () => {
    expect(parentDir("/home/me/Notes/proj/")).toBe("/home/me/Notes");
  });

  it("returns the Windows parent", () => {
    expect(parentDir("C:\\Users\\me\\proj")).toBe("C:\\Users\\me");
  });
});

describe("removeFromRecent", () => {
  it("removes the matching path", () => {
    expect(removeFromRecent(["/a", "/b", "/c"], "/b")).toEqual(["/a", "/c"]);
  });

  it("is a no-op when the path is absent", () => {
    expect(removeFromRecent(["/a", "/b"], "/gone")).toEqual(["/a", "/b"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(removeFromRecent([], "/a")).toEqual([]);
  });

  it("only removes the first match effectively but filters all equal paths", () => {
    // Dedupes stray duplicates too — the MRU should never hold them, but
    // removeFromRecent must not leave a copy behind if it did.
    expect(removeFromRecent(["/a", "/a", "/b"], "/a")).toEqual(["/b"]);
  });

  it("does not mutate the input", () => {
    const list = ["/a", "/b"];
    removeFromRecent(list, "/a");
    expect(list).toEqual(["/a", "/b"]);
  });
});
