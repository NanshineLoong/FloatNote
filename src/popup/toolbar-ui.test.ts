import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("selection popup action bar", () => {
  it("renders dividers between the three actions", () => {
    expect(mainSource).toContain('className = "popup-action-divider"');
    expect(mainSource).toContain("actionsEl.append(captureBtn, actionDivider(), translateBtn, actionDivider(), questionBtn)");
  });

  it("uses one compact surface instead of three bordered button cards", () => {
    expect(cssSource).toMatch(/\.popup-bar \.fn-btn\s*\{[^}]*border-color:\s*transparent/s);
    expect(cssSource).toMatch(/\.popup-action-divider\s*\{[^}]*width:\s*1px/s);
    expect(cssSource).toMatch(/\.popup-bar \.fn-btn\s*\{[^}]*min-height:\s*28px/s);
  });
});
