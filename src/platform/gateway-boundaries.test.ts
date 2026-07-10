import { describe, expect, it } from "vitest";
import { agentSend } from "./agent";
import { chatCreate } from "./chat-history";
import { renderInline } from "../shared/markdown/inline";
import { createMenu } from "../shared/ui/menu";

describe("frontend boundary modules", () => {
  it("exposes Tauri gateways and UI primitives outside the note feature", () => {
    expect(agentSend).toBeTypeOf("function");
    expect(chatCreate).toBeTypeOf("function");
    expect(renderInline("**shared**")).toBe("<strong>shared</strong>");
    expect(createMenu).toBeTypeOf("function");
  });
});
