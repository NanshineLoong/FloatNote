import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const editor = readFileSync(resolve(root, "src/note/editor.ts"), "utf8");
const preview = readFileSync(resolve(root, "src/note/preview/builder.ts"), "utf8");
const sharedEditor = readFileSync(resolve(root, "src/shared/markdown/editor.ts"), "utf8");
const assistantCss = readFileSync(resolve(root, "src/assistant/styles.css"), "utf8");

describe("dark-theme Markdown readability", () => {
  it("keeps list content at the inherited prose color", () => {
    expect(editor).not.toMatch(/tag:\s*tags\.list,\s*color:/);
    expect(sharedEditor).not.toMatch(/tag:\s*tags\.list,\s*color:/);
    expect(preview).toMatch(/"\.cm-preview-ol-mark":\s*\{\s*color:\s*"var\(--color-text-muted\)"/);
    expect(assistantCss).toMatch(/\.fn-assistant-input \.cm-md-task-list\s*\{\s*color:\s*var\(--color-text\);\s*\}/);
  });

  it("uses adaptive semantic colors for readable preview elements", () => {
    expect(preview).toMatch(/"\.cm-preview-blockquote":\s*\{[\s\S]*?color:\s*"var\(--color-text-muted\)"/);
    expect(preview).toMatch(/"\.cm-preview-inline-code":\s*\{[\s\S]*?background:\s*"var\(--color-surface-3\)"/);
    expect(preview).toMatch(/"\.cm-preview-hr":\s*\{[\s\S]*?borderTop:\s*"1px solid var\(--color-divider\)"/);
    expect(preview).not.toMatch(/color:\s*"#(?:374151|6b7280|9ca3af)"/i);
  });

  it("uses adaptive semantic colors for note syntax highlighting", () => {
    for (const token of [
      "--color-syntax-comment",
      "--color-syntax-keyword",
      "--color-syntax-literal",
      "--color-syntax-string",
      "--color-syntax-variable",
      "--color-syntax-function",
      "--color-syntax-property",
      "--color-syntax-type",
      "--color-syntax-punctuation",
    ]) {
      expect(editor).toContain(`var(${token})`);
    }
  });
});
