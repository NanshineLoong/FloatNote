export interface ProviderProfile {
  id: string;
  label: string;
  piProvider: string;
  models: string[];
  baseUrl?: string;
  allowsCustomModel: boolean;
}

export const DEFAULT_PROVIDER = "anthropic";

export const PROVIDER_PROFILES: ProviderProfile[] = [
  { id: "anthropic", label: "Anthropic", piProvider: "anthropic", models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"], allowsCustomModel: true },
  { id: "openai", label: "OpenAI", piProvider: "openai", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"], allowsCustomModel: true },
  { id: "deepseek", label: "DeepSeek", piProvider: "deepseek", models: ["deepseek-v4-pro", "deepseek-v4-flash"], allowsCustomModel: true },
  { id: "dashscope", label: "阿里云百炼（Qwen）", piProvider: "openai", models: ["qwen3-max", "qwen3.5-plus", "qwen3-coder-plus"], baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", allowsCustomModel: true },
  { id: "minimax", label: "MiniMax", piProvider: "minimax", models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"], allowsCustomModel: true },
  { id: "moonshotai", label: "Moonshot / Kimi", piProvider: "moonshotai", models: ["kimi-k2.7-code", "kimi-k2.6", "kimi-k2-thinking"], allowsCustomModel: true },
  { id: "custom", label: "自定义兼容服务", piProvider: "openai", models: [], allowsCustomModel: true },
];

export function getProviderProfile(id: string): ProviderProfile {
  return PROVIDER_PROFILES.find((profile) => profile.id === id)
    ?? PROVIDER_PROFILES[0];
}

export function normalizeProvider(id: string): string {
  return PROVIDER_PROFILES.some((profile) => profile.id === id) ? id : DEFAULT_PROVIDER;
}
