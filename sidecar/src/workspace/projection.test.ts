import { describe, expect, it } from "vitest";
import { projectInbox } from "./projection.js";

describe("projectInbox", () => {
  it("projects Inbox as clean Markdown plus read-only semantic context", () => {
    const raw = '<!-- floatnote:tags:v2 verify="待验证"|c=#ffcc00 -->\n'
      + '研究<!-- floatnote:ann:v2 id=a tag=verify start -->表明<!-- floatnote:ann:v2 id=a end -->如此';
    const result = projectInbox(raw, { offset: 1, limit: 100 });
    expect(result.markdown).toBe("研究表明如此");
    expect(result.context).toContain('verify「待验证」');
    expect(result.context).toContain('“表明”');
    expect(result.markdown + result.context).not.toContain("floatnote:ann:v2");
  });

  it("returns only semantic items intersecting the selected clean line window", () => {
    const raw = '<!-- floatnote:tags:v2 verify="待验证"|c=#ffcc00 -->\n'
      + 'first\n<!-- floatnote:ann:v2 id=a tag=verify start -->second<!-- floatnote:ann:v2 id=a end -->\nthird<!-- floatnote:bid=com.example.browser -->';
    const first = projectInbox(raw, { offset: 1, limit: 1 });
    expect(first.markdown).toBe("first");
    expect(first.context).not.toContain("second");
    expect(first.context).not.toContain("com.example.browser");
    const rest = projectInbox(raw, { offset: 2, limit: 2 });
    expect(rest.context).toContain("second");
    expect(rest.context).toContain("com.example.browser");
  });
});
