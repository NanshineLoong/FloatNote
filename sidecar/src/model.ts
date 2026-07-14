import { getModel } from "@earendil-works/pi-ai/compat";
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";

export type AiProviderId = "openai" | "deepseek" | "anthropic" | "bailian" | "kimi" | "zhipu";

export interface AgentConfig {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface ResolvedAgentConfig extends AgentConfig {
  thinkingLevel?: ThinkingLevel;
}

const FALLBACK_CONTEXT_WINDOW = 128000;
const FALLBACK_MAX_TOKENS = 16384;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const ENDPOINTS: Record<AiProviderId, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  kimi: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

export function buildAgentModel(cfg: AgentConfig): Model<Api> {
  const modelId = cfg.model.trim();
  if (!modelId) throw new Error("模型 ID 不能为空");
  const baseUrl = normalizeBaseUrl(cfg.baseUrl) ?? ENDPOINTS[cfg.provider];
  const native = nativeModel(cfg.provider, modelId);

  if (cfg.provider === "openai") {
    if (!cfg.baseUrl && native) return native;
    return configuredModel(cfg.provider, modelId, baseUrl, "openai-completions", native);
  }
  if (cfg.provider === "anthropic") {
    if (!cfg.baseUrl && native) return native;
    return configuredModel(cfg.provider, modelId, baseUrl, "anthropic-messages", native);
  }
  if (cfg.provider === "deepseek") {
    return native ?? fallbackModel("deepseek", modelId, baseUrl, "openai-completions");
  }
  if (cfg.provider === "kimi") {
    return native ?? fallbackModel("moonshotai-cn", modelId, baseUrl, "openai-completions", reasoningFor(cfg.provider, modelId));
  }
  if (cfg.provider === "zhipu") {
    return configuredModel("zhipu", modelId, baseUrl, "openai-completions", native, reasoningFor(cfg.provider, modelId));
  }
  return configuredModel("bailian", modelId, baseUrl, "openai-completions", native, reasoningFor(cfg.provider, modelId));
}

export function resolveAgentConfig(cfg: AgentConfig): ResolvedAgentConfig {
  const model = buildAgentModel(cfg);
  return {
    ...cfg,
    model: cfg.model.trim(),
    baseUrl: normalizeBaseUrl(cfg.baseUrl),
    thinkingLevel: cfg.thinkingLevel ?? automaticThinkingLevel(model),
  };
}

export function sanitizeAgentError(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter((value) => value.length >= 4)) {
    message = message.split(secret).join("[已隐藏]");
  }
  return message
    .replace(/(?:sk-|key-)[A-Za-z0-9._-]{6,}/gi, "[已隐藏]")
    .replace(/(authorization|api[_ -]?key|access[_ -]?token|token)\s*[:=]\s*[^\s&]+/gi, "$1: [已隐藏]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s]+/gi, "$1[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏]@");
}

function nativeModel(provider: AiProviderId, modelId: string): Model<Api> | undefined {
  const piProvider = provider === "kimi" ? "moonshotai-cn" : provider === "zhipu" ? "zai" : provider;
  const direct = (getModel as (provider: string, modelId: string) => Model<Api> | undefined)(piProvider, modelId);
  if (direct || provider !== "bailian") return direct;
  for (const candidate of ["deepseek", "moonshotai-cn", "zai", "openai"]) {
    const match = (getModel as (provider: string, modelId: string) => Model<Api> | undefined)(candidate, modelId);
    if (match) return match;
  }
  return undefined;
}

function configuredModel(
  provider: string,
  modelId: string,
  baseUrl: string,
  api: Api,
  native?: Model<Api>,
  knownReasoning = false,
): Model<Api> {
  if (!native) return fallbackModel(provider, modelId, baseUrl, api, knownReasoning);
  const reasoning = native.reasoning || knownReasoning;
  return {
    ...native,
    id: modelId,
    name: native.name || modelId,
    provider,
    api,
    baseUrl,
    cost: native.cost ?? ZERO_COST,
    reasoning,
    compat: {
      ...native.compat,
      ...(provider === "bailian" && reasoning ? { thinkingFormat: "qwen" as const } : {}),
    },
  };
}

function fallbackModel(
  provider: string,
  modelId: string,
  baseUrl: string,
  api: Api,
  reasoning = reasoningFor(provider as AiProviderId, modelId),
): Model<Api> {
  const thinkingFormat = provider === "zhipu"
    ? "zai"
    : provider === "bailian"
      ? "qwen"
      : provider === "deepseek" || provider === "moonshotai-cn"
        ? "deepseek"
        : undefined;
  return {
    id: modelId,
    name: modelId,
    provider,
    api,
    baseUrl,
    reasoning,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    maxTokens: FALLBACK_MAX_TOKENS,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: reasoning && provider === "deepseek",
      maxTokensField: "max_tokens",
      ...(thinkingFormat ? { thinkingFormat } : {}),
    },
  };
}

function automaticThinkingLevel(model: Model<Api>): ThinkingLevel | undefined {
  if (!model.reasoning) return undefined;
  const map = model.thinkingLevelMap;
  for (const level of ["high", "medium", "low", "minimal"] as const) {
    if (map?.[level] !== null) return level;
  }
  return undefined;
}

function reasoningFor(provider: AiProviderId, modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (provider === "deepseek") return /reasoner|[-_.]r1(?:[-_.]|$)/.test(id);
  if (provider === "bailian") return /qwen3|deepseek[-_.]r1|kimi[-_.]k2\.(?:5|6|7)|glm[-_.](?:4\.[5-9]|5)/.test(id);
  if (provider === "kimi") return /thinking|kimi[-_.]k2\.(?:5|6|7)/.test(id);
  if (provider === "zhipu") return /glm[-_.](?:4\.[5-9]|5)/.test(id);
  return false;
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Base URL 必须是有效的 http 或 https 地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 必须是有效的 http 或 https 地址");
  }
  if (url.username || url.password) {
    throw new Error("Base URL 不能包含用户名或密码");
  }
  return trimmed.replace(/\/+$/, "");
}
