import { describe, expect, test } from "vitest";
import { chatScopeForSession } from "./assistant-controller";
import { createNoteSession } from "./note-session";

describe("chatScopeForSession", () => {
  test("uses the standalone document directory as the chat working directory", () => {
    const session = createNoteSession();
    session.openDocument({ name: "draft", path: "/notes/draft.md" });

    expect(chatScopeForSession(session)).toEqual({
      scopeType: "document",
      scopePath: "/notes/draft.md",
      scopeLabel: "draft",
      cwd: "/notes",
    });
  });
});
