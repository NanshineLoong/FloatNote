import { describe, expect, it } from "vitest";
import { parentDir, pushRecent, RECENT_LIMIT } from "./recent-projects";

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
