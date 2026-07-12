import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  getProviderProfile,
  normalizeProvider,
  PROVIDER_PROFILES,
} from "./provider-profiles";

describe("AI provider profiles", () => {
  it("offers the curated providers and no Google profile", () => {
    expect(PROVIDER_PROFILES.map((profile) => profile.id)).toEqual([
      "anthropic",
      "openai",
      "deepseek",
      "dashscope",
      "minimax",
      "moonshotai",
      "custom",
    ]);
  });

  it("maps DashScope to Pi's OpenAI-compatible configuration", () => {
    const profile = getProviderProfile("dashscope");
    expect(profile.piProvider).toBe("openai");
    expect(profile.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(profile.models.length).toBeGreaterThan(0);
  });

  it("migrates invalid legacy providers to the default", () => {
    expect(normalizeProvider("")).toBe(DEFAULT_PROVIDER);
    expect(normalizeProvider("google")).toBe(DEFAULT_PROVIDER);
    expect(normalizeProvider("custom")).toBe("custom");
  });
});
