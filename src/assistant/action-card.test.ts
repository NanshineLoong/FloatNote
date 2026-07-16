// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildActionCard } from "./action-card";
import type { ActionBlock } from "./render/state";

describe("action cards", () => {
  it("marks a rejected tool with its independent visual state", () => {
    const block: ActionBlock = {
      id: "tool-1",
      kind: "action",
      tool: "write",
      targets: [],
      decision: "pending",
      execution: "rejected",
    };

    const card = buildActionCard(block);

    expect(card.classList.contains("chat-action-rejected")).toBe(true);
    expect(card.textContent).toContain("已拒绝");
  });

  it("gives rejected compact tool titles a stronger warning selector", () => {
    const css = readFileSync(resolve(process.cwd(), "src/assistant/styles.css"), "utf8");

    expect(css).toContain(".chat-action.chat-action-readonly.chat-action-rejected .chat-action-header");
  });
});
