import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeLine } from "./protocol.js";
import type { SidecarToHost, HostToSidecar } from "./protocol.js";

describe("encodeLine", () => {
  it("escapes embedded newlines so each message stays on one line", () => {
    const msg: SidecarToHost = {
      type: "review_mutation",
      callId: "c1",
      conversationId: "conv1",
      toolCallId: "tool-1",
      toolName: "edit",
      operation: "edit",
      path: "piece.md",
      oldContent: "line one\nline two",
      newContent: "line three\nline four",
      createOnly: false,
      preview: { tool: "edit", summary: "替换", detail: { kind: "diff", hunks: "@@\n-a\n+b" } },
    };
    const line = encodeLine(msg);
    // exactly one terminator newline, none inside the payload
    expect(line.split("\n").filter((s) => s.length > 0)).toHaveLength(1);
    expect(JSON.parse(line)).toEqual(msg);
  });
});

describe("workspace protocol", () => {
  it("encodes list and read round trips", () => {
    const list: SidecarToHost = {
      type: "workspace_list",
      callId: "l1",
      conversationId: "cv1",
    };
    const read: SidecarToHost = {
      type: "workspace_read",
      callId: "r1",
      conversationId: "cv1",
      path: "_inbox.md",
    };
    expect(JSON.parse(encodeLine(list))).toEqual(list);
    expect(JSON.parse(encodeLine(read))).toEqual(read);
  });
});

describe("mutation transaction protocol", () => {
  it("encodes review, approval lease, and commit", () => {
    const review: SidecarToHost = {
      type: "review_mutation",
      callId: "review-1",
      conversationId: "cv1",
      toolCallId: "tool-1",
      toolName: "write",
      operation: "create",
      path: "Ideas.md",
      oldContent: "",
      newContent: "# Ideas\n",
      createOnly: true,
      preview: {
        tool: "write",
        summary: "创建文档「Ideas.md」",
        detail: { kind: "note_create", filename: "Ideas.md", contentPreview: "# Ideas\n" },
      },
    };
    expect(JSON.parse(encodeLine(review))).toEqual(review);

    const approved: HostToSidecar = {
      type: "mutation_review_result",
      callId: "review-1",
      allowed: true,
      lease: "lease-1",
      writeMode: "direct",
    };
    expect(approved.lease).toBe("lease-1");

    const commit: SidecarToHost = {
      type: "commit_mutation",
      callId: "commit-1",
      conversationId: "cv1",
      toolCallId: "tool-1",
      lease: "lease-1",
    };
    expect(JSON.parse(encodeLine(commit))).toEqual(commit);
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
