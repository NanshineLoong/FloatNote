import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("split view CSS placement", () => {
  it("pins both editor columns to the first grid row in split mode", () => {
    expect(css).toMatch(
      /#app\.split-active\s+#text-col\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s,
    );
    expect(css).toMatch(
      /#app\.split-active\s+#piece-col\s*{[^}]*grid-column:\s*4;[^}]*grid-row:\s*1;/s,
    );
  });

  // layout-controller 把 --piece / --split-gap 写到 #app 上。这两个变量的默认值必须
  // 也定义在 #app（而非 #note-body），否则 #note-body 的本地声明会遮蔽来自 #app 的值，
  // 使 var(--piece) 恒为 0、双栏写作栏宽度塌成 0（不可见、不可编辑）。
  it("declares split grid vars on #app, not shadowed by #note-body", () => {
    const appBody = css.match(/#app\s*{([^}]*)}/s)?.[1] ?? "";
    const noteBodyBody = css.match(/#note-body\s*{([^}]*)}/s)?.[1] ?? "";
    expect(appBody).toMatch(/--piece:/);
    expect(appBody).toMatch(/--split-gap:/);
    expect(noteBodyBody).not.toMatch(/--piece:/);
    expect(noteBodyBody).not.toMatch(/--split-gap:/);
  });

  it("lets the piece editor fill the writing column", () => {
    expect(css).toMatch(
      /#piece-scroll\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*flex:\s*1 1 auto;/s,
    );
    expect(css).toMatch(
      /#piece-editor-root\s*{[^}]*position:\s*relative;[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/s,
    );
  });
});
