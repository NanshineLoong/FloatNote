import { describe, expect, it } from "vitest";
import { buildAgentModel, resolveAgentConfig, sanitizeAgentError } from "./model.js";

describe("fixed provider model resolution", () => {
  it("reuses Pi's native OpenAI model on the official endpoint", () => {
    const model = buildAgentModel({ provider: "openai", model: "gpt-5", apiKey: "key" });
    expect(model.provider).toBe("openai");
    expect(model.api).toBe("openai-responses");
    expect(model.contextWindow).toBeGreaterThan(128000);
  });

  it("uses Chat Completions for an OpenAI custom Base URL", () => {
    const model = buildAgentModel({
      provider: "openai",
      model: "gpt-5",
      apiKey: "key",
      baseUrl: "https://proxy.example/v1///",
    });
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://proxy.example/v1");
  });

  it("keeps Anthropic Messages for an Anthropic custom Base URL", () => {
    const model = buildAgentModel({
      provider: "anthropic",
      model: "claude-opus-4-5",
      apiKey: "key",
      baseUrl: "https://anthropic-proxy.example/v1",
    });
    expect(model.api).toBe("anthropic-messages");
    expect(model.provider).toBe("anthropic");
  });

  it("maps Kimi to the native China provider", () => {
    const model = buildAgentModel({ provider: "kimi", model: "kimi-k2.5", apiKey: "key" });
    expect(model.provider).toBe("moonshotai-cn");
    expect(model.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(model.compat?.thinkingFormat).toBe("deepseek");
  });

  it("reuses Z.AI metadata but sends Zhipu traffic to the China endpoint", () => {
    const model = buildAgentModel({ provider: "zhipu", model: "glm-4.7", apiKey: "key" });
    expect(model.provider).toBe("zhipu");
    expect(model.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(model.compat?.thinkingFormat).toBe("zai");
  });

  it("uses Bailian's OpenAI-compatible endpoint and Qwen thinking format", () => {
    const model = buildAgentModel({ provider: "bailian", model: "qwen3-max", apiKey: "key" });
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(model.reasoning).toBe(true);
    expect(model.compat?.thinkingFormat).toBe("qwen");
  });

  it.each(["deepseek-r1", "deepseek-v4-pro", "kimi-k2.5", "glm-4.7"])(
    "forces Bailian's Qwen thinking format for hosted reasoning model %s",
    (modelId) => {
      const model = buildAgentModel({ provider: "bailian", model: modelId, apiKey: "key" });
      expect(model.reasoning).toBe(true);
      expect(model.compat?.thinkingFormat).toBe("qwen");
    },
  );

  it("creates a 128K/16K provider fallback without guessing thinking", () => {
    const model = buildAgentModel({ provider: "deepseek", model: "future-chat", apiKey: "key" });
    expect(model).toMatchObject({
      provider: "deepseek",
      contextWindow: 128000,
      maxTokens: 16384,
      input: ["text"],
      reasoning: false,
    });
  });

  it("automatically selects high only for reasoning-capable models", () => {
    expect(resolveAgentConfig({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: "key" }).thinkingLevel)
      .toBe("high");
    expect(resolveAgentConfig({ provider: "deepseek", model: "future-chat", apiKey: "key" }).thinkingLevel)
      .toBeUndefined();
  });

  it("removes API keys, authorization values, and URL credentials from errors", () => {
    const sanitized = sanitizeAgentError(
      new Error("api_key=sk-supersecret authorization: Bearer-secret https://user:pass@example.com/v1"),
    );
    expect(sanitized).not.toContain("sk-supersecret");
    expect(sanitized).not.toContain("Bearer-secret");
    expect(sanitized).not.toContain("user:pass");
    expect(sanitized).toContain("[已隐藏]");
  });

  it("redacts exact configured secrets and credential query parameters", () => {
    const sanitized = sanitizeAgentError(
      new Error("failed token=plain-secret at https://example.com/v1?api_key=query-secret&x=1"),
      ["plain-secret"],
    );
    expect(sanitized).not.toContain("plain-secret");
    expect(sanitized).not.toContain("query-secret");
  });

  it("rejects Base URLs with embedded credentials", () => {
    expect(() => buildAgentModel({
      provider: "openai",
      model: "gpt-5",
      apiKey: "key",
      baseUrl: "https://user:password@example.com/v1",
    })).toThrow("不能包含用户名或密码");
  });
});
