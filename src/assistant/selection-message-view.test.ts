// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMessage } from "./render/view";

describe("selection user message", () => {
  it("projects a valid selection callout into a question and collapsible quote card", () => {
    const node = renderMessage({
      id: "m1",
      role: "user",
      text: "Why?\n\n> [!selection] Source\n> line one\n> line two\n> line three\n> line four",
    });
    expect(node.querySelector(".chat-user-message-text")?.textContent).toBe("Why?");
    expect(node.querySelector(".chat-selection-source")?.textContent).toBe("Source");
    expect(node.querySelector(".chat-selection-card")?.classList.contains("is-collapsed")).toBe(true);
    node.querySelector<HTMLButtonElement>(".chat-selection-toggle")?.click();
    expect(node.querySelector(".chat-selection-card")?.classList.contains("is-collapsed")).toBe(false);
  });
});
