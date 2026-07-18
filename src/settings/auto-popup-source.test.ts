import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = ["main.ts", "shell.ts", "general.ts", "skills.ts", "shortcuts.ts"]
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
  .join("\n");

describe("selection popup settings", () => {
  it("offers auto, shortcut-only, and off without modifier mode", () => {
    expect(source).toContain('<option value="auto"');
    expect(source).toContain('<option value="shortcut"');
    expect(source).toContain('<option value="off"');
    expect(source).not.toContain('<option value="modifier"');
    expect(source).not.toContain('<option value="every"');
  });

  it("uses tabbed autosave settings without obsolete controls", () => {
    expect(source).toContain('data-tab="general"');
    expect(source).toContain('data-tab="ai"');
    expect(source).toContain('data-tab="shortcuts"');
    expect(source).not.toContain('save-btn');
    expect(source).not.toContain('piece-outline-default');
    expect(source).not.toContain('未配置');
    expect(source).not.toContain('value="google"');
  });

  it("matches the approved settings information architecture", () => {
    expect(source).toContain("<span>AI</span>");
    expect(source).not.toContain("AI 导师");
    expect(source).toContain("开机启动");
    expect(source).not.toContain("界面字号");
    expect(source).toContain("跟随系统");
    expect(source).toContain('value="light"');
    expect(source).toContain('value="dark"');
    expect(source).toContain('id="popup-shortcut-row"');
    expect(source).toContain('config.auto_popup_mode === "shortcut"');
    expect(source).toContain("自动弹出");
    expect(source).toContain("快捷键");
  });

  it("imports a directory rather than a markdown file", () => {
    expect(source).toContain("directory: true");
    expect(source).not.toContain('extensions: ["md"]');
  });
});
