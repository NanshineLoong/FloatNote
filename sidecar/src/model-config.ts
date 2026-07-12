import type { Api, Model } from "@earendil-works/pi-ai";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ConnectionProtocol = "openai-responses" | "openai-completions" | "anthropic-messages";

export interface CustomModelDefinition {
  id: string;
  name?: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  compat?: Model<Api>["compat"];
}

export interface AiConnection {
  id: string;
  name: string;
  kind: "official-openai" | "official-anthropic" | "custom";
  provider: string;
  protocol: ConnectionProtocol;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  models: CustomModelDefinition[];
}

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function buildConfiguredModel(connection: AiConnection, modelId: string): Model<Api> {
  const definition = connection.models.find((model) => model.id === modelId);
  if (!definition) throw new Error(`连接 ${connection.name} 未配置模型：${modelId}`);
  if (!connection.baseUrl) throw new Error(`连接 ${connection.name} 缺少 API 地址`);
  const baseUrl = connection.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseUrl)) {
    throw new Error("API 地址必须使用 HTTPS；仅 localhost 可使用 HTTP。");
  }
  return {
    id: definition.id, name: definition.name ?? definition.id, provider: connection.provider,
    api: connection.protocol, baseUrl, reasoning: definition.reasoning,
    thinkingLevelMap: definition.thinkingLevelMap, input: definition.input,
    contextWindow: definition.contextWindow, maxTokens: definition.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: definition.compat,
  } as Model<Api>;
}

export function clampThinkingLevel(level: ThinkingLevel, map?: Partial<Record<ThinkingLevel, string | null>>): ThinkingLevel {
  const available = LEVELS.filter((candidate) => map?.[candidate] !== null);
  if (!available.length) return "off";
  if (available.includes(level)) return level;
  return available.find((candidate) => candidate !== "off") ?? available[0];
}
