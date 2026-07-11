// @vitest-environment node
import { describe, it, expect } from "vitest";
import { detectTrigger } from "./trigger";

describe("detectTrigger", () => {
  it("@ 在空白后触发，返回 file 模式与 @query 区间", () => {
    const text = "你好 @pie";
    expect(detectTrigger(text, text.length)).toEqual({
      mode: "file",
      query: "pie",
      from: 3, // '@' 在 index 3
      to: text.length,
    });
  });

  it("@ 在行首触发", () => {
    const text = "@pie";
    expect(detectTrigger(text, text.length)).toEqual({
      mode: "file",
      query: "pie",
      from: 0,
      to: 4,
    });
  });

  it("@ 空查询也命中（刚键入 @）", () => {
    const text = "hi @";
    expect(detectTrigger(text, text.length)).toEqual({
      mode: "file",
      query: "",
      from: 3,
      to: 4,
    });
  });

  it("句中 @ 不触发（邮箱 a@b）", () => {
    const text = "a@b";
    expect(detectTrigger(text, text.length)).toBeNull();
  });

  it("query 含空格不命中（已在写参数）", () => {
    const text = "hi @foo bar";
    expect(detectTrigger(text, text.length)).toBeNull();
  });

  it("/ 在空白后触发 skill 模式", () => {
    const text = "你好 /sum";
    expect(detectTrigger(text, text.length)).toEqual({
      mode: "skill",
      query: "sum",
      from: 3,
      to: text.length,
    });
  });

  it("/ 在行首触发", () => {
    const text = "/sum";
    expect(detectTrigger(text, text.length)).toEqual({
      mode: "skill",
      query: "sum",
      from: 0,
      to: 4,
    });
  });

  it("路径 src/app 不触发 /", () => {
    const text = "src/app";
    expect(detectTrigger(text, text.length)).toBeNull();
  });

  it("/skill 参数（含空格）不触发", () => {
    const text = "/foo bar";
    expect(detectTrigger(text, text.length)).toBeNull();
  });

  it("光标移出触发区（非结尾）返回 null", () => {
    const text = "hi @pie rest";
    // 光标在 '@' 前
    expect(detectTrigger(text, 2)).toBeNull();
  });

  it("无 @ 无 / 返回 null", () => {
    expect(detectTrigger("普通文本", 4)).toBeNull();
  });
});
