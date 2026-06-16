import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeLine } from "./protocol.js";
import type { SidecarToHost } from "./protocol.js";

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
      type: "apply_write",
      callId: "c1",
      noteId: "n",
      content: "line one\nline two",
    };
    const line = encodeLine(msg);
    // exactly one terminator newline, none inside the payload
    expect(line.split("\n").filter((s) => s.length > 0)).toHaveLength(1);
    expect(JSON.parse(line)).toEqual(msg);
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
    const out = decode('pt","requestId":"r1","noteId":"n","noteText":"t","userText":"u"}\n');
    expect(out).toEqual([
      { type: "prompt", requestId: "r1", noteId: "n", noteText: "t", userText: "u" },
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
});
