// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  REF_OPEN,
  REF_CLOSE,
  parseDoc,
  serializeDoc,
  refToken,
  refsInDoc,
  visibleText,
  hasRef,
  type Ref,
} from "./model";

const FILE: Ref = { kind: "file", id: "p/piece.md", display: "piece.md", meta: { noteKind: "piece" } };
const SKILL: Ref = { kind: "skill", id: "summarize", display: "summarize" };

describe("model round-trip", () => {
  it("纯文本切成单个 text 段", () => {
    expect(parseDoc("你好")).toEqual([{ type: "text", text: "你好" }]);
  });

  it("token 起止哨兵包裹 JSON", () => {
    expect(refToken(FILE)).toBe(REF_OPEN + JSON.stringify(FILE) + REF_CLOSE);
  });

  it("parseDoc 把文本与引用交织成 Segment[]", () => {
    const text = `你好${refToken(FILE)}帮我${refToken(SKILL)}它`;
    expect(parseDoc(text)).toEqual([
      { type: "text", text: "你好" },
      { type: "ref", ref: FILE },
      { type: "text", text: "帮我" },
      { type: "ref", ref: SKILL },
      { type: "text", text: "它" },
    ]);
  });

  it("serializeDoc 是 parseDoc 的逆", () => {
    const text = `你好${refToken(FILE)}它`;
    const back = serializeDoc(parseDoc(text));
    expect(back).toBe(text);
  });

  it("连续引用之间无空 text 段", () => {
    const text = `${refToken(FILE)}${refToken(SKILL)}`;
    expect(parseDoc(text)).toEqual([
      { type: "ref", ref: FILE },
      { type: "ref", ref: SKILL },
    ]);
  });

  it("损坏的 token（非 JSON / 缺字段）跳过，不漏哨兵进正文", () => {
    const text = `你好${REF_OPEN}not-json${REF_CLOSE}它`;
    expect(parseDoc(text)).toEqual([
      { type: "text", text: "你好" },
      { type: "text", text: "它" },
    ]);
  });
});

describe("display/id 分离", () => {
  it("display 改变不影响 id", () => {
    const renamed: Ref = { ...FILE, display: "旧名.md" };
    expect(renamed.id).toBe(FILE.id);
    expect(renamed.display).not.toBe(FILE.display);
  });

  it("id 含特殊字符也能安全编码", () => {
    const tricky: Ref = { kind: "file", id: 'a|b"c.md', display: 'x|y"z' };
    const text = refToken(tricky);
    expect(refsInDoc(text)).toEqual([tricky]);
  });
});

describe("refsInDoc / visibleText / hasRef", () => {
  it("refsInDoc 按文档顺序返回引用", () => {
    const text = `${refToken(FILE)}帮我${refToken(SKILL)}`;
    expect(refsInDoc(text)).toEqual([FILE, SKILL]);
  });

  it("visibleText 只返回 text 段", () => {
    expect(visibleText(parseDoc(`你好${refToken(FILE)}它`))).toBe("你好它");
  });

  it("hasRef", () => {
    expect(hasRef(`你好${refToken(FILE)}它`)).toBe(true);
    expect(hasRef("你好它")).toBe(false);
  });
});
