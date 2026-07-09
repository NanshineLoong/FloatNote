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

  it("closes the history popover from outside clicks", () => {
    expect(assistantSource).toContain('document.addEventListener("pointerdown"');
  });

  it("exposes handle methods for the central shortcut dispatcher", () => {
    expect(assistantSource).toContain("setInputOpen");
    expect(assistantSource).toContain("isInputOpen");
    expect(assistantSource).toContain("isStreaming");
    expect(assistantSource).toContain("isHistoryPopoverOpen");
    expect(assistantSource).toContain("closeHistoryPopover");
    expect(assistantSource).toContain("startNewConversation");
  });

  it("injects a listSkills dep and mounts the skill picker", () => {
    expect(assistantSource).toContain("listSkills:");
    expect(assistantSource).toContain("mountSkillPicker");
    expect(assistantSource).toContain("isSkillMenuOpen");
    expect(assistantSource).toContain("closeSkillMenu");
  });

  it("shows the new conversation action only when the assistant is expanded with messages", () => {
    expect(assistantCss).toMatch(/\.assistant\.expanded\.has-messages\s+\.assistant-new\s*{/);
    expect(assistantCss).not.toMatch(/\.assistant\.expanded\s+\.assistant-new\s*{/);
  });

  it("lets floating-mode users click the new conversation action", () => {
    expect(appCss).toMatch(
      /#app\.mode-floating\s+#assistant-region\s+\.assistant-bot,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-new,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-scroll,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-input-wrap,[\s\S]*#app\.mode-floating\s+#assistant-region\s+\.assistant-perm-region\s*{/,
    );
  });

  it("lets floating-mode users click the permission bubble buttons", () => {
    // #assistant-region 整块 pointer-events:none（点穿到正文），只有白名单子元素 auto。
    // 权限气泡挂在 .assistant-perm-region，必须也在白名单里，否则按钮在 floating 态不可点。
    expect(appCss).toMatch(
      /#app\.mode-floating\s+#assistant-region\s+\.assistant-perm-region\s*{[^}]*pointer-events:\s*auto;/s,
    );
  });

  it("starts inline assistant below the fixed content control row", () => {
    expect(appCss).toMatch(/--assistant-topbar-h:\s*37px;/);
    expect(appCss).toMatch(/top:\s*max\(var\(--assistant-topbar-h, 37px\), var\(--action-h, 0px\)\);/);
    expect(appCss).toMatch(/#app\.doc-mode\s*{[^}]*--assistant-topbar-h:\s*0px;/s);
  });
});
