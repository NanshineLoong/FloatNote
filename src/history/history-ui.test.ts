import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const historySource = readFileSync(resolve(process.cwd(), "src/history/main.ts"), "utf8");
const historyCss = readFileSync(resolve(process.cwd(), "src/history/styles.css"), "utf8");

describe("history window UI", () => {
  it("uses an icon toolbar instead of a title-heavy header", () => {
    expect(historySource).toContain("history-toolbar");
    expect(historySource).toContain("ph-clock-counter-clockwise");
    expect(historySource).not.toContain("<h1>");
  });

  it("supports clearing conversations older than seven or thirty days", () => {
    expect(historySource).toContain('data-days="7"');
    expect(historySource).toContain('data-days="30"');
  });

  it("renders scope and time as secondary row metadata", () => {
    expect(historySource).toContain("history-scope");
    expect(historySource).toContain("formatHistoryTime");
  });

  it("styles destructive and secondary actions as icon controls", () => {
    expect(historyCss).toContain(".history-icon-btn");
    expect(historyCss).toContain(".history-delete");
  });
});
