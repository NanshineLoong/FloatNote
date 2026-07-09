import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeLine } from "./protocol.js";
import type { SidecarToHost, HostToSidecar, NoteTarget } from "./protocol.js";

describe("encodeLine", () => {
  it("produces a single newline-terminated JSON line", () => {
    const msg: SidecarToHost = { type: "ready" };
    const line = encodeLine(msg);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual({ type: "ready" });
  });

  it("escapes embedded newlines so each message stays on one line", () => {
    const msg: SidecarToHost = {
      type: "apply_edit",
      callId: "c1",
      conversationId: "conv1",
      target: { kind: "inbox" },
      toolName: "replace",
      oldContent: "line one\nline two",
      newContent: "line three\nline four",
      preview: { tool: "replace", summary: "替换", detail: { kind: "diff", hunks: "@@\n-a\n+b" } },
    };
    const line = encodeLine(msg);
    // exactly one terminator newline, none inside the payload
    expect(line.split("\n").filter((s) => s.length > 0)).toHaveLength(1);
    expect(JSON.parse(line)).toEqual(msg);
  });
});

describe("apply_edit protocol", () => {
  const target: NoteTarget = { kind: "inbox" };
  it("encodes apply_edit with preview", () => {
    const msg: SidecarToHost = {
      type: "apply_edit",
      callId: "w1",
      conversationId: "c1",
      target,
      toolName: "set_tag",
      oldContent: "a",
      newContent: "b",
      preview: { tool: "set_tag", summary: "打标签", detail: { kind: "tag_assign", blockPreview: "块", tagName: "review", tagColor: "#e5484d" } },
    };
    const line = encodeLine(msg);
    expect(line).toContain('"type":"apply_edit"');
    expect(line).toContain('"toolName":"set_tag"');
    expect(line.endsWith("\n")).toBe(true);
  });
  it("decodes apply_edit_result with denied", () => {
    const line = encodeLine({ type: "apply_edit_result", callId: "w1", ok: false, denied: true } as HostToSidecar);
    expect(JSON.parse(line)).toMatchObject({ type: "apply_edit_result", callId: "w1", denied: true });
  });
  it("encodes get_note_text / note_text", () => {
    const req: SidecarToHost = { type: "get_note_text", callId: "g1", conversationId: "c1", target };
    const res: HostToSidecar = { type: "note_text", callId: "g1", content: "doc", found: true };
    expect(encodeLine(req)).toContain('"type":"get_note_text"');
    expect(encodeLine(res)).toContain('"type":"note_text"');
  });
});

describe("skills protocol", () => {
  it("encodes list_skills / skills_list round-trip", () => {
    const req: HostToSidecar = { type: "list_skills", callId: "sl1" };
    const res: SidecarToHost = {
      type: "skills_list",
      callId: "sl1",
      skills: [{ name: "socratic-review", description: "追问" }],
    };
    expect(encodeLine(req)).toContain('"type":"list_skills"');
    expect(JSON.parse(encodeLine(req))).toEqual(req);
    expect(JSON.parse(encodeLine(res))).toEqual(res);
  });

  it("encodes set_skill_paths", () => {
    const msg: HostToSidecar = { type: "set_skill_paths", skillPaths: ["/a/skills", "/b/skills"] };
    const line = encodeLine(msg);
    expect(line).toContain('"type":"set_skill_paths"');
    expect(JSON.parse(line)).toEqual(msg);
  });

  it("decodes list_skills and set_skill_paths via createLineDecoder", () => {
    const decode = createLineDecoder();
    const out = decode(
      [
        '{"type":"list_skills","callId":"sl1"}',
        '{"type":"set_skill_paths","skillPaths":["/a","/b"]}',
      ].join("\n") + "\n",
    );
    expect(out).toEqual([
      { type: "list_skills", callId: "sl1" },
      { type: "set_skill_paths", skillPaths: ["/a", "/b"] },
    ]);
  });
});

describe("createLineDecoder", () => {
  it("decodes a complete line in one chunk", () => {
    const decode = createLineDecoder();
    const out = decode('{"type":"ready"}\n');
    expect(out).toEqual([{ type: "ready" }]);
  });

  it("accumulates a half line split across chunks", () => {
    const decode = createLineDecoder();
    expect(decode('{"type":"prom')).toEqual([]);
    const out = decode('pt","requestId":"r1","conversationId":"c1","userText":"u"}\n');
    expect(out).toEqual([
      { type: "prompt", requestId: "r1", conversationId: "c1", userText: "u" },
    ]);
  });

  it("decodes multiple lines arriving in one chunk and ignores blank lines", () => {
    const decode = createLineDecoder();
    const out = decode('{"type":"ready"}\n\n{"type":"done","requestId":"r1"}\n');
    expect(out).toEqual([
      { type: "ready" },
      { type: "done", requestId: "r1" },
    ]);
  });

  it("retains a trailing partial line in the buffer", () => {
    const decode = createLineDecoder();
    const first = decode('{"type":"ready"}\n{"type":"do');
    expect(first).toEqual([{ type: "ready" }]);
    const second = decode('ne","requestId":"r1"}\n');
    expect(second).toEqual([{ type: "done", requestId: "r1" }]);
  });

  it("decodes session lifecycle messages", () => {
    const decode = createLineDecoder();
    const out = decode(
      [
        '{"type":"new_session","conversationId":"c1","cwd":"/tmp/project","sessionDir":"/tmp/sessions"}',
        '{"type":"open_session","conversationId":"c2","sessionFile":"/tmp/sessions/c2.jsonl"}',
        "",
      ].join("\n"),
    );
    expect(out).toEqual([
      { type: "new_session", conversationId: "c1", cwd: "/tmp/project", sessionDir: "/tmp/sessions" },
      { type: "open_session", conversationId: "c2", sessionFile: "/tmp/sessions/c2.jsonl" },
    ]);
  });
});
