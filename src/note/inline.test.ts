import { describe, expect, it } from "vitest";
import { renderInline } from "./inline";

describe("renderInline", () => {
  it("renders bold", () => {
    expect(renderInline("**bold**")).toBe("<strong>bold</strong>");
  });

  it("renders emphasis", () => {
    expect(renderInline("*em*")).toBe("<em>em</em>");
  });

  it("renders inline code, escaping inner characters", () => {
    expect(renderInline("`a < b`")).toBe("<code>a &lt; b</code>");
  });

  it("renders a link with escaped url/label", () => {
    expect(renderInline("[t](http://u/x)")).toBe('<a href="http://u/x">t</a>');
  });

  it("escapes double quotes in a link URL (href attribute safety)", () => {
    expect(renderInline('[t](http://u/a"b)')).toBe('<a href="http://u/a&quot;b">t</a>');
  });

  it("renders strikethrough", () => {
    expect(renderInline("~~s~~")).toBe("<del>s</del>");
  });

  it("escapes plain text with HTML-significant characters", () => {
    expect(renderInline("a & b <c>")).toBe("a &amp; b &lt;c&gt;");
  });

  it("renders nested emphasis inside strong", () => {
    expect(renderInline("**a *b***")).toBe("<strong>a <em>b</em></strong>");
  });
});
