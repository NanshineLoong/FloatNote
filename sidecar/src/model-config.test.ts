import { describe, expect, it } from "vitest";
import { buildConfiguredModel, clampThinkingLevel, type AiConnection } from "./model-config.js";

const anthropicProxy: AiConnection = {
  id: "proxy", name: "Team Anthropic", kind: "custom", provider: "team-anthropic",
  protocol: "anthropic-messages", apiKey: "secret", baseUrl: "https://proxy.example/v1",
  models: [{ id: "claude-proxy", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 32000 }],
};

describe("PI-native model configuration", () => {
  it("preserves an Anthropic-compatible connection protocol", () => {
    expect(buildConfiguredModel(anthropicProxy, "claude-proxy")).toMatchObject({
      provider: "team-anthropic", api: "anthropic-messages", baseUrl: "https://proxy.example/v1", reasoning: true,
    });
  });

  it("clamps a saved thinking level to the model's supported PI levels", () => {
    expect(clampThinkingLevel("medium", { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: "max" })).toBe("high");
  });
});
