import { describe, expect, it } from "vitest";
import { resolveAgentWriteNavigation } from "./agent-write-navigation";

describe("resolveAgentWriteNavigation", () => {
  const project = { name: "Novel", path: "/notes/Novel" };

  it("opens the first piece created by AI in an empty project", () => {
    expect(resolveAgentWriteNavigation(
      { noteId: "Chapter 1", path: "/notes/Novel/Chapter 1.md", version: 0 },
      { mode: "project", project, document: null },
    )).toEqual({
      kind: "piece",
      entry: { name: "Chapter 1", path: "/notes/Novel/Chapter 1.md" },
    });
  });

  it("routes Inbox and Tasks writes to their dedicated surfaces", () => {
    expect(resolveAgentWriteNavigation(
      { noteId: "_inbox", path: "/notes/Novel/_inbox.md", version: 0 },
      { mode: "project", project, document: null },
    )).toEqual({ kind: "inbox", path: "/notes/Novel/_inbox.md" });

    expect(resolveAgentWriteNavigation(
      { noteId: "_tasks", path: "/notes/Novel/_tasks.md", version: 0 },
      { mode: "project", project, document: null },
    )).toEqual({ kind: "tasks", path: "/notes/Novel/_tasks.md" });
  });

  it("ignores writes outside the active project", () => {
    expect(resolveAgentWriteNavigation(
      { noteId: "Chapter 2", path: "/notes/Other/Chapter 2.md", version: 0 },
      { mode: "project", project, document: null },
    )).toBeNull();
  });

  it("matches Windows project paths without depending on slash style or drive case", () => {
    expect(resolveAgentWriteNavigation(
      { noteId: "Plan", path: "c:/Notes/Novel/Plan.md", version: 0 },
      { mode: "project", project: { name: "Novel", path: "C:\\Notes\\Novel" }, document: null },
    )).toEqual({
      kind: "piece",
      entry: { name: "Plan", path: "c:/Notes/Novel/Plan.md" },
    });
  });

  it("refreshes only the active standalone document in document mode", () => {
    const document = { name: "Loose", path: "/notes/Loose.md" };
    expect(resolveAgentWriteNavigation(
      { noteId: "Loose", path: "/notes/Loose.md", version: 0 },
      { mode: "document", project, document },
    )).toEqual({ kind: "document", entry: document });

    expect(resolveAgentWriteNavigation(
      { noteId: "Other", path: "/notes/Other.md", version: 0 },
      { mode: "document", project, document },
    )).toBeNull();
  });
});
