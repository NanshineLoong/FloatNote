import { describe, expect, test } from "vitest";
import { chatScopeForSession, createAgentConversation } from "./assistant-controller";
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

describe("createAgentConversation", () => {
  test("removes the new index and session when agent session creation fails", async () => {
    const conversation = {
      id: "c1", sessionFile: "/tmp/c1.jsonl", scopeType: "project" as const,
      scopePath: "/notes", scopeLabel: "Notes", title: "新对话", titleState: "temporary" as const,
      createdAt: 0, updatedAt: 0, lastOpenedAt: 0,
    };
    const discarded: string[] = [];
    const deleted: string[] = [];
    await expect(createAgentConversation(
      { scopeType: "project", scopePath: "/notes", scopeLabel: "Notes", cwd: "/notes" },
      {
        create: async () => conversation,
        newSession: async () => { throw new Error("session failed"); },
        discard: async (item) => { discarded.push(item.id); },
        delete: async (item) => { deleted.push(item.id); },
      },
    )).rejects.toThrow("session failed");
    expect(discarded).toEqual(["c1"]);
    expect(deleted).toEqual(["c1"]);
  });

  test("still deletes the history index if session discard fails", async () => {
    const conversation = {
      id: "c1", sessionFile: "/tmp/c1.jsonl", scopeType: "project" as const,
      scopePath: "/notes", scopeLabel: "Notes", title: "新对话", titleState: "temporary" as const,
      createdAt: 0, updatedAt: 0, lastOpenedAt: 0,
    };
    let deleted = false;
    await expect(createAgentConversation(
      { scopeType: "project", scopePath: "/notes", scopeLabel: "Notes", cwd: "/notes" },
      {
        create: async () => conversation,
        newSession: async () => { throw new Error("session failed"); },
        discard: async () => { throw new Error("discard failed"); },
        delete: async () => { deleted = true; },
      },
    )).rejects.toThrow("session failed");
    expect(deleted).toBe(true);
  });
});
