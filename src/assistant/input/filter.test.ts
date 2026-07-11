// @vitest-environment node
import { describe, it, expect } from "vitest";
import { filterItems, type Candidate } from "./filter";

function file(name: string, noteKind: "inbox" | "tasks" | "piece" | "doc" = "piece"): Candidate {
  return { ref: { kind: "file", id: `p/${name}`, display: name, meta: { noteKind } } };
}
function skill(name: string, description = ""): Candidate {
  return { ref: { kind: "skill", id: name, display: name }, description };
}

describe("filterItems", () => {
  it("空 query 返回全量（原序）", () => {
    const items = [file("a.md"), file("b.md")];
    const r = filterItems(items, "");
    expect(r.map((x) => x.candidate.ref.display)).toEqual(["a.md", "b.md"]);
  });

  it("无匹配返回空", () => {
    expect(filterItems([file("a.md")], "zzz")).toEqual([]);
  });

  it("前缀匹配优先于子串", () => {
    const items = [file("foo-bar.md"), file("bar-foo.md")];
    const r = filterItems(items, "foo");
    expect(r[0].candidate.ref.display).toBe("foo-bar.md"); // 前缀
  });

  it("description 也参与匹配", () => {
    const items = [skill("x", "summarize notes"), skill("y", "translate")];
    const r = filterItems(items, "summ");
    expect(r.map((x) => x.candidate.ref.display)).toEqual(["x"]);
  });

  it("词边界匹配优于普通子串", () => {
    // piece.md: 'piece' 是词首；cap: 'piece' 在 'cap' 后非边界
    const items = [file("capiece.md"), file("piece.md")];
    const r = filterItems(items, "piece");
    expect(r[0].candidate.ref.display).toBe("piece.md");
  });

  it("同分时标签更短优先", () => {
    const items = [file("a-very-long-name.md"), file("a.md")];
    // 两者都是前缀匹配 'a'；更短标签优先
    const r = filterItems(items, "a");
    expect(r[0].candidate.ref.display).toBe("a.md");
  });

  it("大小写无关", () => {
    const items = [file("Piece.md")];
    expect(filterItems(items, "PIECE").length).toBe(1);
  });
});
