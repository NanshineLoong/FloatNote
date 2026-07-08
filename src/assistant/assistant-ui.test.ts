import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const assistantSource = readFileSync(resolve(process.cwd(), "src/assistant/assistant.ts"), "utf8");
const assistantCss = readFileSync(resolve(process.cwd(), "src/assistant/styles.css"), "utf8");
const appCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("assistant session UI", () => {
  it("renders new conversation as an icon action", () => {
    expect(assistantSource).toContain('class="assistant-new"');
    expect(assistantSource).toContain('aria-label="新对话"');
    expect(assistantSource).toContain('title="新对话"');
    expect(assistantSource).toContain("ph-plus");
  });

  it("mounts the history popover outside the horizontally clipped input wrap", () => {
    expect(assistantSource).toMatch(
      /<div class="assistant-dock">[\s\S]*<div class="assistant-history-popover" hidden><\/div>[\s\S]*<div class="assistant-input-wrap">/,
    );
  });

  it("updates temporary conversation titles from the first user message", () => {
    expect(assistantSource).toContain("updateConversationTitle");
    expect(assistantSource).toContain("deriveTitleFromFirstMessage");
  });

  it("closes the history popover from outside clicks and Escape", () => {
    expect(assistantSource).toContain('document.addEventListener("pointerdown"');
    expect(assistantSource).toContain('document.addEventListener("keydown"');
    expect(assistantSource).toContain('e.key === "Escape"');
  });

  it("shows the new conversation action only when the assistant is expanded with messages", () => {
    expect(assistantCss).toMatch(/\.assistant\.expanded\.has-messages\s+\.assistant-new\s*{/);
    expect(assistantCss).not.toMatch(/\.assistant\.expanded\s+\.assistant-new\s*{/);
  });

  it("lets floating-mode users click the new conversation action", () => {
    expect(appCss).toMatch(
      /#app\.mode-floating\s+#assistant-region\s+\.assistant-bot,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-new,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-scroll,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-input-wrap\s*{/,
    );
  });

  it("starts inline assistant below the fixed content control row", () => {
    expect(appCss).toMatch(/--assistant-topbar-h:\s*37px;/);
    expect(appCss).toMatch(/top:\s*max\(var\(--assistant-topbar-h, 37px\), var\(--action-h, 0px\)\);/);
    expect(appCss).toMatch(/#app\.doc-mode\s*{[^}]*--assistant-topbar-h:\s*0px;/s);
  });
});
