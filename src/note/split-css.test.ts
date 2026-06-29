import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const editorSource = readFileSync(resolve(process.cwd(), "src/note/editor.ts"), "utf8");
const assistantCss = readFileSync(resolve(process.cwd(), "src/assistant/styles.css"), "utf8");
const assistantBubbleColor = assistantCss.match(/\.chat-assistant\s*{[^}]*background:\s*(#[0-9a-fA-F]{6});/s)?.[1];

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

  it("keeps inbox block handles in the compact left margin", () => {
    expect(css).toMatch(
      /#editor-root\s*{[^}]*overflow:\s*visible;/s,
    );
    expect(editorSource).toMatch(/padding:\s*"16px 0"/);
    expect(css).toMatch(
      /#editor-root\s+\.cm-scroller\s*{[^}]*margin-left:\s*-14px;[^}]*width:\s*calc\(100% \+ 14px\);/s,
    );
    expect(css).toMatch(
      /\.cm-block-gutter\s*{[^}]*width:\s*14px;/s,
    );
    expect(css).toMatch(
      /#editor-root\s+\.cm-gutters\s*{[^}]*border-right:\s*none;[^}]*border-left:\s*none;[^}]*background:\s*transparent;/s,
    );
    expect(css).toMatch(
      /\.cm-block-gutter:hover\s+\.cm-block-handle\s*{[^}]*opacity:\s*1;/s,
    );
    expect(css).toMatch(
      /\.cm-block-handle:hover\s*{[^}]*opacity:\s*1;/s,
    );
    expect(css).not.toMatch(/\.cm-editor:hover\s+\.cm-block-handle\s*{/);
  });

  it("gives the floating assistant a soft background without bubble borders", () => {
    expect(css).toMatch(
      /#app\.mode-floating\s+#assistant-region\s+\.assistant-scroll\s*{[^}]*background:\s*rgba\([^;]+;[^}]*backdrop-filter:\s*blur\([^}]+;[^}]*box-shadow:/s,
    );
    expect(css).not.toMatch(
      /#app\.mode-floating\s+#assistant-region\s+\.assistant-scroll::before\s*{/,
    );
    expect(assistantCss).toMatch(
      /#app\.mode-floating\s+\.chat-assistant\s*{[^}]*background:\s*#[0-9a-fA-F]{6};[^}]*border:\s*none;/s,
    );
    expect(assistantCss.match(/#app\.mode-floating\s+\.chat-assistant\s*{[^}]*background:\s*(#[0-9a-fA-F]{6});/s)?.[1]).toBe(
      assistantBubbleColor,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*{[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-scroll\s*{[^}]*background:\s*rgba\([^;]+;[^}]*box-shadow:/s,
    );
  });

  it("does not rerun message entrance animation while assistant text streams", () => {
    expect(assistantCss).toMatch(
      /\.chat-streaming\s*{[^}]*animation:\s*none;/s,
    );
  });
});
