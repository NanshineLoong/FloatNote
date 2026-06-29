import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getModel, type Api, type Model } from "@earendil-works/pi-ai";
import { createNoteTools, type WriteResult } from "./note-tools.js";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";
import type { HostToSidecar, SidecarToHost } from "./protocol.js";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** Minimal surface of a Pi AgentSession the runner depends on (injectable for tests). */
export interface SessionLike {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
}

export type SessionFactory = (
  cfg: AgentConfig,
  tools: ToolDefinition[],
) => Promise<SessionLike>;

export interface AgentRunnerOptions {
  /** Emit a protocol line to the host. */
  send: (msg: SidecarToHost) => void;
  /** Override session creation in tests. Defaults to a real Pi session. */
  createSession?: SessionFactory;
}

export interface PromptRequest {
  requestId: string;
  noteId: string;
  noteText: string;
  userText: string;
}

const EMPTY_RESPONSE_MESSAGE = "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。";
const DEFAULT_CUSTOM_CONTEXT_WINDOW = 128000;
const DEFAULT_CUSTOM_MAX_TOKENS = 8192;

export function buildAgentModel(cfg: AgentConfig): Model<Api> {
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

/**
 * Translate a Pi agent-session event into a single protocol line, or null when
 * the event is not relevant to the host (thinking deltas, tool updates, etc.).
 */
export function translateEvent(
  requestId: string,
  event: AgentSessionEvent,
): SidecarToHost | null {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return { type: "delta", requestId, text: inner.delta };
      }
      return null;
    }
    case "tool_execution_start":
      return { type: "tool", requestId, name: event.toolName, phase: "start" };
    case "tool_execution_end":
      return { type: "tool", requestId, name: event.toolName, phase: "end" };
    case "agent_end":
      return { type: "done", requestId };
    default:
      return null;
  }
}

/**
 * Drives a tutor session: builds the note tools (with host-delegated writes),
 * forwards prompts to Pi, and streams events back to the host as protocol lines.
 */
export class AgentRunner {
  private readonly send: (msg: SidecarToHost) => void;
  private readonly factory: SessionFactory;
  private session?: SessionLike;
  private noteId = "";
  private noteText = "";
  private writeSeq = 0;
  private readonly pendingWrites = new Map<string, (r: WriteResult) => void>();

  constructor(options: AgentRunnerOptions) {
    this.send = options.send;
    this.factory = options.createSession ?? defaultCreateSession;
  }

  async configure(cfg: AgentConfig): Promise<void> {
    const tools = createNoteTools({
      getNoteText: () => this.noteText,
      requestWrite: (content) => this.requestWrite(content),
    });
    this.session = await this.factory(cfg, tools);
  }

  async prompt(req: PromptRequest): Promise<void> {
    if (!this.session) {
      throw new Error("agent not configured");
    }
    this.noteId = req.noteId;
    this.noteText = req.noteText;
    let sawVisibleOutput = false;
    const unsubscribe = this.session.subscribe((event) => {
      const msg = translateEvent(req.requestId, event);
      if (!msg) return;
      if (msg.type === "delta" || msg.type === "tool") {
        sawVisibleOutput = true;
      }
      if (msg.type === "done" && !sawVisibleOutput) {
        this.send({ type: "error", requestId: req.requestId, message: EMPTY_RESPONSE_MESSAGE });
      }
      this.send(msg);
    });
    try {
      await this.session.prompt(req.userText);
    } finally {
      unsubscribe();
    }
  }

  /** Resolve a pending write once the host reports the snapshot result. */
  onApplyWriteResult(msg: Extract<HostToSidecar, { type: "apply_write_result" }>): void {
    const resolve = this.pendingWrites.get(msg.callId);
    if (resolve) {
      this.pendingWrites.delete(msg.callId);
      resolve({ ok: msg.ok, version: msg.version, error: msg.error });
    }
  }

  async cancel(): Promise<void> {
    await this.session?.abort();
  }

  private requestWrite(content: string): Promise<WriteResult> {
    const callId = `w${++this.writeSeq}`;
    return new Promise<WriteResult>((resolve) => {
      this.pendingWrites.set(callId, resolve);
      this.send({ type: "apply_write", callId, noteId: this.noteId, content });
    });
  }
}

/** Build a real Pi tutor session from config. */
const defaultCreateSession: SessionFactory = async (cfg, tools) => {
  const authStorage = AuthStorage.inMemory();
  if (cfg.apiKey) {
    authStorage.setRuntimeApiKey(cfg.provider, cfg.apiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => TUTOR_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  const model = buildAgentModel(cfg);

  const { session } = await createAgentSession({
    model,
    customTools: tools,
    tools: ["read_note", "write_note"],
    noTools: "builtin",
    resourceLoader,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
  });
  return session;
};
