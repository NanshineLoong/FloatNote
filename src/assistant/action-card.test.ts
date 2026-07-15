// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildActionCard } from "./action-card";
import type { ActionBlock } from "./render/state";

describe("action cards", () => {
  it("marks a rejected tool with its independent visual state", () => {
    const block: ActionBlock = {
      id: "tool-1",
      kind: "action",
      tool: "write_note",
      targets: [],
      decision: "pending",
      execution: "rejected",
    };

    const card = buildActionCard(block);

    expect(card.classList.contains("chat-action-rejected")).toBe(true);
    expect(card.textContent).not.toContain("已拒绝");
  });
});
