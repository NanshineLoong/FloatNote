import { describe, it, expect } from "vitest";
import { inboxPath, inboxEntry } from "./notes-state";

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
