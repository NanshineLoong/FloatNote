import { describe, expect, it } from "vitest";
import { createNoteTools, type WriteResult } from "./note-tools.js";

function toolMap(deps: {
  getNoteText: () => string;
  requestWrite: (content: string) => Promise<WriteResult>;
}) {
  const tools = createNoteTools(deps);
  return new Map(tools.map((t) => [t.name, t]));
}

const noop = undefined;

describe("read_note", () => {
  it("returns the current note text", async () => {
    const tools = toolMap({
      getNoteText: () => "current contents",
      requestWrite: async () => ({ ok: true, version: 1 }),
    });
    const result = await tools.get("read_note")!.execute("call-1", {}, noop, noop, {} as never);
    expect(result.content).toEqual([{ type: "text", text: "current contents" }]);
  });
});

describe("write_note", () => {
  it("forwards content to requestWrite and reports the new version on success", async () => {
    let received: string | undefined;
    const tools = toolMap({
      getNoteText: () => "",
      requestWrite: async (content) => {
        received = content;
        return { ok: true, version: 7 };
      },
    });
    const result = await tools
      .get("write_note")!
      .execute("call-2", { content: "new full text" }, noop, noop, {} as never);
    expect(received).toBe("new full text");
    expect(result.content[0]).toEqual({ type: "text", text: "已更新笔记，版本 v7" });
  });

  it("returns an error message when the host rejects the write", async () => {
    const tools = toolMap({
      getNoteText: () => "",
      requestWrite: async () => ({ ok: false, error: "disk full" }),
    });
    const result = await tools
      .get("write_note")!
      .execute("call-3", { content: "x" }, noop, noop, {} as never);
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("disk full");
  });
});
