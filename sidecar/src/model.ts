import { getModel } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";
import { buildConfiguredModel, type AiConnection, type ThinkingLevel } from "./model-config.js";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  connection?: AiConnection;
  thinkingLevel?: ThinkingLevel;
}

const DEFAULT_CUSTOM_CONTEXT_WINDOW = 128000;
const DEFAULT_CUSTOM_MAX_TOKENS = 8192;

export function buildAgentModel(cfg: AgentConfig): Model<Api> {
  if (cfg.connection?.kind === "custom") return buildConfiguredModel(cfg.connection, cfg.model);
  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  if (baseUrl) {
    validateOpenAICompatibleBaseUrl(baseUrl);
    return {
      id: cfg.model,
      name: cfg.model,
      api: "openai-completions",
      provider: cfg.provider,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CUSTOM_CONTEXT_WINDOW,
      maxTokens: DEFAULT_CUSTOM_MAX_TOKENS,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStore: false,
        maxTokensField: "max_tokens",
        thinkingFormat: "qwen",
      },
    };
  }

  const model = (getModel as (provider: string, modelId: string) => Model<Api> | undefined)(
    cfg.provider,
    cfg.model,
  );
  if (!model) {
    throw new Error(
      `模型未在 PI 内置列表中找到：${cfg.provider}/${cfg.model}。如果这是 OpenAI 兼容服务，请填写 baseUrl。`,
    );
  }
  return model;
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

function validateOpenAICompatibleBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`自定义地址不是有效 URL：${baseUrl}`);
  }

  if (/\/apps\/anthropic\/?$/.test(url.pathname)) {
    throw new Error(
      "当前自定义地址不是 OpenAI 兼容地址，而是 Anthropic 应用接口。百炼 OpenAI 兼容 Chat 地址应使用 /compatible-mode/v1。",
    );
  }
}
