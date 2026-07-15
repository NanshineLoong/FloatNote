import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeLine } from "./protocol.js";
import type { SidecarToHost, HostToSidecar, NoteTarget } from "./protocol.js";

describe("encodeLine", () => {
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
      toolName: "tag_text",
      oldContent: "a",
      newContent: "b",
      preview: { tool: "tag_text", summary: "打标签", detail: { kind: "tag_assign", textExcerpt: "文本", targetText: "文本全文", annotationCount: 1, action: "add", tagName: "review", tagColor: "#e5484d" } },
    };
    const line = encodeLine(msg);
    expect(line).toContain('"type":"apply_edit"');
    expect(line).toContain('"toolName":"tag_text"');
    expect(line).toContain('"targetText":"文本全文"');
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

describe("project note protocol", () => {
  it("encodes list and confirmed create round-trips", () => {
    const list: SidecarToHost = { type: "list_notes", callId: "l1", conversationId: "c1" };
    const listed: HostToSidecar = { type: "notes_list", callId: "l1", notes: [{ kind: "piece", name: "piece.md" }] };
    const create: SidecarToHost = { type: "create_note", callId: "c1", conversationId: "cv", toolCallId: "t1", title: "Ideas", content: "body", preview: { tool: "create_note", summary: "创建", detail: { kind: "note_create", filename: "Ideas.md", contentPreview: "body" } } };
    expect(JSON.parse(encodeLine(list))).toEqual(list);
    expect(JSON.parse(encodeLine(listed))).toEqual(listed);
    expect(JSON.parse(encodeLine(create))).toEqual(create);
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

describe("configure protocol", () => {
  it("correlates a candidate config with its result", () => {
    const req: HostToSidecar = {
      type: "configure",
      callId: "cfg1",
      provider: "kimi",
      model: "kimi-k2.5",
      apiKey: "secret",
    };
    const result: SidecarToHost = { type: "configure_result", callId: "cfg1", ok: true };
    expect(JSON.parse(encodeLine(req))).toEqual(req);
    expect(JSON.parse(encodeLine(result))).toEqual(result);
  });

  it("correlates a clear-configuration request", () => {
    const req: HostToSidecar = { type: "clear_configuration", callId: "cfg-clear" };
    expect(JSON.parse(encodeLine(req))).toEqual(req);
  });

  it("returns a provider-scoped error without echoing the key", () => {
    const result: SidecarToHost = {
      type: "configure_result",
      callId: "cfg2",
      ok: false,
      error: "Kimi API / future-model 配置失败，请检查模型 ID",
    };
    expect(encodeLine(result)).not.toContain("secret");
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
        '{"type":"new_session","callId":"ns1","conversationId":"c1","cwd":"/tmp/project","sessionDir":"/tmp/sessions"}',
        '{"type":"open_session","conversationId":"c2","sessionFile":"/tmp/sessions/c2.jsonl"}',
        "",
      ].join("\n"),
    );
    expect(out).toEqual([
      { type: "new_session", callId: "ns1", conversationId: "c1", cwd: "/tmp/project", sessionDir: "/tmp/sessions" },
      { type: "open_session", conversationId: "c2", sessionFile: "/tmp/sessions/c2.jsonl" },
    ]);
  });
});
