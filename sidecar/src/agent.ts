import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
  type SessionManager as PiSessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getModel, type Api, type Model } from "@earendil-works/pi-ai";
import { createNoteTools, type WriteResult } from "./note-tools.js";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";
import { listSkills as listSkillsState, readSkillBody, loadSkillPaths, formatSkillsForSystemPrompt } from "./skills.js";
import type { ChatDisplayMessage, EditPreview, HostToSidecar, NoteTarget, SidecarToHost } from "./protocol.js";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** Minimal surface of a Pi AgentSession the runner depends on (injectable for tests). */
export interface SessionLike {
  sessionFile?: string;
  sessionManager?: Pick<PiSessionManager, "getBranch" | "getSessionFile">;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose?: () => void;
}

export type SessionFactory = (
  cfg: AgentConfig,
  tools: ToolDefinition[],
  sessionManager: PiSessionManager,
) => Promise<SessionLike>;

export interface AgentRunnerOptions {
  /** Emit a protocol line to the host. */
  send: (msg: SidecarToHost) => void;
  /** Override session creation in tests. Defaults to a real Pi session. */
  createSession?: SessionFactory;
}

export interface PromptRequest {
  requestId: string;
  conversationId: string;
  userText: string;
}

export interface NewSessionRequest {
  conversationId: string;
  cwd: string;
  sessionDir: string;
}

export interface OpenSessionRequest {
  conversationId: string;
  sessionFile: string;
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
 * the event is not relevant to the host. We forward text + thinking blocks
 * (streamed into the chat bubble) and tool execution start/end; toolcall_*
 * (the model emitting a tool-call block) is dropped — the action card's
 * structured detail arrives via the permission://request flow instead.
 */
export function translateEvent(
  requestId: string,
  conversationId: string,
  event: AgentSessionEvent,
): SidecarToHost | null {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return { type: "delta", requestId, conversationId, text: inner.delta };
      }
      if (inner.type === "thinking_start") {
        return { type: "thinking_start", requestId, conversationId, blockId: `${requestId}-t${inner.contentIndex}` };
      }
      if (inner.type === "thinking_delta") {
        return { type: "thinking_delta", requestId, conversationId, text: inner.delta };
      }
      if (inner.type === "thinking_end") {
        return { type: "thinking_end", requestId, conversationId };
      }
      return null;
    }
    case "tool_execution_start":
      return { type: "tool", requestId, conversationId, name: event.toolName, phase: "start" };
    case "tool_execution_end":
      return { type: "tool", requestId, conversationId, name: event.toolName, phase: "end" };
    case "agent_end":
      return { type: "done", requestId, conversationId };
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
  private cfg?: AgentConfig;
  private readonly sessions = new Map<string, SessionLike>();
  private writeSeq = 0;
  private textSeq = 0;
  private readonly pendingEdits = new Map<string, (r: WriteResult) => void>();
  private readonly pendingTexts = new Map<string, (r: { content: string; found: boolean }) => void>();

  constructor(options: AgentRunnerOptions) {
    this.send = options.send;
    this.factory = options.createSession ?? defaultCreateSession;
  }

  async configure(cfg: AgentConfig): Promise<void> {
    this.cfg = cfg;
  }

  /** Deliver skill directories from the host; loads them into memory once. */
  async setSkillPaths(paths: string[]): Promise<void> {
    loadSkillPaths(paths);
  }

  /** Synchronous enumeration of loaded skills (no host round-trip). */
  listSkills(): { name: string; description: string }[] {
    return listSkillsState();
  }

  async newSession(req: NewSessionRequest): Promise<void> {
    const sessionManager = SessionManager.create(req.cwd, req.sessionDir, { id: req.conversationId });
    await this.installSession(req.conversationId, sessionManager);
  }

  async openSession(req: OpenSessionRequest): Promise<void> {
    const sessionManager = SessionManager.open(req.sessionFile);
    await this.installSession(req.conversationId, sessionManager);
  }

  async prompt(req: PromptRequest): Promise<void> {
    const session = this.sessions.get(req.conversationId);
    if (!session) {
      throw new Error("conversation session not opened");
    }
    let sawVisibleOutput = false;
    const unsubscribe = session.subscribe((event) => {
      const msg = translateEvent(req.requestId, req.conversationId, event);
      if (!msg) return;
      if (msg.type === "delta" || msg.type === "tool" || msg.type === "thinking_start") {
        sawVisibleOutput = true;
      }
      if (msg.type === "done" && !sawVisibleOutput) {
        this.send({
          type: "error",
          requestId: req.requestId,
          conversationId: req.conversationId,
          message: EMPTY_RESPONSE_MESSAGE,
        });
      }
      this.send(msg);
    });
    try {
      await session.prompt(req.userText);
    } finally {
      unsubscribe();
    }
  }

  /** Resolve a pending get_note_text round-trip with the host-supplied content. */
  onNoteText(msg: Extract<HostToSidecar, { type: "note_text" }>): void {
    const resolve = this.pendingTexts.get(msg.callId);
    if (resolve) {
      this.pendingTexts.delete(msg.callId);
      resolve({ content: msg.content, found: msg.found });
    }
  }

  /** Resolve a pending apply_edit round-trip with the host-supplied result. */
  onApplyEditResult(msg: Extract<HostToSidecar, { type: "apply_edit_result" }>): void {
    const resolve = this.pendingEdits.get(msg.callId);
    if (resolve) {
      this.pendingEdits.delete(msg.callId);
      resolve({ ok: msg.ok, denied: msg.denied, version: msg.version, error: msg.error });
    }
  }

  async cancel(_requestId?: string): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.abort()));
  }

  private async installSession(conversationId: string, sessionManager: PiSessionManager): Promise<void> {
    if (!this.cfg) {
      throw new Error("agent not configured");
    }
    this.sessions.get(conversationId)?.dispose?.();
    const tools = createNoteTools({
      getNoteText: (target) => this.getNoteText(conversationId, target),
      requestWrite: (args) => this.requestWrite(conversationId, args),
      readSkillBody: (name) => readSkillBody(name),
    });
    const session = await this.factory(this.cfg, tools, sessionManager);
    this.sessions.set(conversationId, session);
    const sessionFile = session.sessionFile ?? session.sessionManager?.getSessionFile() ?? sessionManager.getSessionFile();
    if (!sessionFile) {
      throw new Error("persistent session file unavailable");
    }
    this.send({
      type: "session_opened",
      conversationId,
      sessionFile,
      messages: displayMessagesFromSession(session),
    });
  }

  private getNoteText(conversationId: string, target?: NoteTarget): Promise<string> {
    const callId = `g${++this.textSeq}`;
    const msg: SidecarToHost = {
      type: "get_note_text",
      callId,
      conversationId,
      // target 缺省=当前活动笔记；仅当调用方给出时携带，由 Rust 解析。
      ...(target ? { target } : {}),
    };
    return new Promise<string>((resolve) => {
      this.pendingTexts.set(callId, (r) => resolve(r.content));
      this.send(msg);
    });
  }

  private requestWrite(
    conversationId: string,
    args: { target?: NoteTarget; toolName: string; oldContent: string; newContent: string; preview: EditPreview },
  ): Promise<WriteResult> {
    const callId = `w${++this.writeSeq}`;
    const msg: SidecarToHost = {
      type: "apply_edit",
      callId,
      conversationId,
      // target 缺省=当前活动笔记；仅当调用方给出时携带，由 Rust 解析。
      ...(args.target ? { target: args.target } : {}),
      toolName: args.toolName,
      oldContent: args.oldContent,
      newContent: args.newContent,
      preview: args.preview,
    };
    return new Promise<WriteResult>((resolve) => {
      this.pendingEdits.set(callId, resolve);
      this.send(msg);
    });
  }
}

/** Build a real Pi tutor session from config. */
const defaultCreateSession: SessionFactory = async (cfg, tools, sessionManager) => {
  const authStorage = AuthStorage.inMemory();
  if (cfg.apiKey) {
    authStorage.setRuntimeApiKey(cfg.provider, cfg.apiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);
  const cwd = sessionManager.getCwd();

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => TUTOR_SYSTEM_PROMPT + "\n\n" + formatSkillsForSystemPrompt(),
  });
  await resourceLoader.reload();

  const model = buildAgentModel(cfg);

  const { session } = await createAgentSession({
    model,
    customTools: tools,
    tools: ["read_note", "list_tags", "edit_note", "write_note", "set_tag", "tag_create", "tag_delete", "read_skill"],
    noTools: "builtin",
    resourceLoader,
    authStorage,
    modelRegistry,
    sessionManager,
  });
  return session;
};

export function displayMessagesFromSession(session: SessionLike): ChatDisplayMessage[] {
  const branch = session.sessionManager?.getBranch() ?? [];
  return branch.flatMap((entry): ChatDisplayMessage[] => {
    if (entry.type !== "message") return [];
    const timestamp = Date.parse(entry.timestamp);
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
    const message = entry.message as { role?: string; content?: unknown };
    const text = messageText(message);
    if (!text) return [];
    if (message.role === "user") {
      return [{ role: "user", text, timestamp: safeTimestamp }];
    }
    if (message.role === "assistant") {
      return [{ role: "assistant", text, timestamp: safeTimestamp }];
    }
    if (message.role === "tool") {
      return [{ role: "tool", label: text, timestamp: safeTimestamp }];
    }
    return [];
  });
}

function messageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}
