import { complete } from "@earendil-works/pi-ai/compat";
import { existsSync } from "node:fs";
import type { Context } from "@earendil-works/pi-ai";
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
import { createNoteTools, type CreateNoteResult, type NoteListEntry, type WriteResult } from "./note-tools.js";
import { createDefaultWebTools } from "./web-tools.js";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";
import { listSkills as listSkillsState, readSkillBody, loadSkillPaths, formatSkillsForSystemPrompt } from "./skills.js";
import type { ChatDisplayBlock, ChatDisplayMessage, EditPreview, HostToSidecar, NoteTarget, PromptRef, SidecarToHost } from "./protocol.js";
import { buildAgentModel, resolveAgentConfig, sanitizeAgentError, type AgentConfig } from "./model.js";
import { translateEvent } from "./event-translate.js";
import { composePromptText } from "./prompt-compose.js";
import { formatToolTitle, sanitizeToolError } from "./tool-title.js";

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
  references?: PromptRef[];
  skill?: { name: string };
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

type RewindableSessionManager = Pick<PiSessionManager, "getBranch" | "branch" | "resetLeaf">;

/** Move the active leaf to immediately before a visible user turn. */
export function rewindSessionToUserTurn(manager: RewindableSessionManager, userEntryId: string): void {
  const target = manager.getBranch().find(
    (entry) => entry.id === userEntryId && entry.type === "message" && entry.message.role === "user",
  );
  if (!target) throw new Error("user turn not found in active session branch");
  if (target.parentId) manager.branch(target.parentId);
  else manager.resetLeaf();
}

const EMPTY_RESPONSE_MESSAGE = "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。";

/**
 * Drives a tutor session: builds the note tools (with host-delegated writes),
 * forwards prompts to Pi, and streams events back to the host as protocol lines.
 */
export class AgentRunner {
  private readonly send: (msg: SidecarToHost) => void;
  private readonly factory: SessionFactory;
  private cfg?: AgentConfig;
  private readonly sessions = new Map<string, SessionLike>();
  private readonly sessionManagers = new Map<string, PiSessionManager>();
  private readonly activeConversations = new Map<string, string>();
  private writeSeq = 0;
  private textSeq = 0;
  private readonly pendingEdits = new Map<string, (r: WriteResult) => void>();
  private readonly pendingTexts = new Map<string, (r: { content: string; found: boolean }) => void>();
  private readonly pendingLists = new Map<string, (notes: NoteListEntry[]) => void>();
  private readonly pendingCreates = new Map<string, (result: CreateNoteResult) => void>();

  constructor(options: AgentRunnerOptions) {
    this.send = options.send;
    this.factory = options.createSession ?? defaultCreateSession;
  }

  async configure(cfg: AgentConfig): Promise<void> {
    if (this.activeConversations.size > 0) {
      throw new Error("请等待当前回复完成后再切换 AI 提供商");
    }
    const resolved = resolveAgentConfig(cfg);
    const replacements = new Map<string, SessionLike>();
    try {
      for (const [conversationId, sessionManager] of this.sessionManagers) {
        replacements.set(conversationId, await this.createConfiguredSession(resolved, conversationId, sessionManager));
      }
    } catch (error) {
      for (const session of replacements.values()) session.dispose?.();
      throw error;
    }
    for (const [conversationId, replacement] of replacements) {
      this.sessions.get(conversationId)?.dispose?.();
      this.sessions.set(conversationId, replacement);
    }
    this.cfg = resolved;
  }

  clearConfiguration(): void {
    if (this.activeConversations.size > 0) {
      throw new Error("请等待当前回复完成后再关闭 AI 提供商");
    }
    for (const session of this.sessions.values()) session.dispose?.();
    this.sessions.clear();
    this.sessionManagers.clear();
    this.cfg = undefined;
  }

  /** Deliver skill directories from the host; loads them into memory once. */
  async setSkillPaths(paths: string[], disabledSkillNames: string[] = []): Promise<void> {
    loadSkillPaths(paths, disabledSkillNames);
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
    if (!existsSync(req.sessionFile)) {
      throw new Error(`conversation session file not found: ${req.sessionFile}`);
    }
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
      if (msg.type === "done" && msg.outcome === "completed" && !sawVisibleOutput) {
        this.send({
          type: "error",
          requestId: req.requestId,
          conversationId: req.conversationId,
          message: EMPTY_RESPONSE_MESSAGE,
        });
      }
      if (msg.type === "done" && msg.outcome === "failed") {
        this.send({
          type: "error",
          requestId: req.requestId,
          conversationId: req.conversationId,
          message: sanitizeAgentError(msg.error ?? "助手运行失败，请稍后重试。", this.cfg?.apiKey ? [this.cfg.apiKey] : []),
        });
      }
      this.send(msg);
    });
    this.activeConversations.set(req.requestId, req.conversationId);
    try {
      // 把结构化 references/skill 序列化进给 Pi 的 prompt 文本：skill 走 /skill:name 前缀
      // 原生展开，文件引用追加 [引用] 块。无引用时原样透传（向后兼容）。
      await session.prompt(composePromptText(req));
      this.emitSessionSynced(req.conversationId);
      void this.generateTitle(req.conversationId, req.userText);
    } finally {
      unsubscribe();
      this.activeConversations.delete(req.requestId);
    }
  }

  /** Discard the selected user turn and its descendants from the active branch. */
  rewind(conversationId: string, userEntryId: string): void {
    if (this.activeConversations.size > 0) {
      throw new Error("cannot rewind while an assistant response is streaming");
    }
    const manager = this.sessionManagers.get(conversationId);
    if (!manager) throw new Error("conversation session not opened");
    rewindSessionToUserTurn(manager, userEntryId);
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

  onNotesList(msg: Extract<HostToSidecar, { type: "notes_list" }>): void {
    const resolve = this.pendingLists.get(msg.callId);
    if (resolve) { this.pendingLists.delete(msg.callId); resolve(msg.notes); }
  }

  onCreateNoteResult(msg: Extract<HostToSidecar, { type: "create_note_result" }>): void {
    const resolve = this.pendingCreates.get(msg.callId);
    if (resolve) { this.pendingCreates.delete(msg.callId); resolve(msg); }
  }

  /** Cancel the in-flight prompt for `requestId`. Scoped to that request's
   *  conversation only — other conversations keep streaming. No-op when the
   *  request is unknown (already finished or never started). */
  async cancel(requestId?: string): Promise<void> {
    const conversationId = requestId ? this.activeConversations.get(requestId) : undefined;
    if (!conversationId) return;
    await this.sessions.get(conversationId)?.abort();
  }

  private async installSession(conversationId: string, sessionManager: PiSessionManager): Promise<void> {
    if (!this.cfg) {
      throw new Error("尚未配置或启用 AI 提供商，请前往设置完成配置并启用。");
    }
    const session = await this.createConfiguredSession(this.cfg, conversationId, sessionManager);
    this.sessions.get(conversationId)?.dispose?.();
    this.sessionManagers.set(conversationId, sessionManager);
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

  private emitSessionSynced(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    const manager = this.sessionManagers.get(conversationId);
    const sessionFile = session?.sessionFile ?? session?.sessionManager?.getSessionFile() ?? manager?.getSessionFile();
    if (!session || !sessionFile) return;
    this.send({
      type: "session_synced",
      conversationId,
      sessionFile,
      messages: displayMessagesFromSession(session),
    });
  }

  private async createConfiguredSession(
    cfg: AgentConfig,
    conversationId: string,
    sessionManager: PiSessionManager,
  ): Promise<SessionLike> {
    const noteTools = createNoteTools({
      getNoteText: (target) => this.getNoteText(conversationId, target),
      listNotes: () => this.listNotes(conversationId),
      requestCreateNote: (args) => this.requestCreateNote(conversationId, args),
      requestWrite: (args) => this.requestWrite(conversationId, args),
      readSkillBody,
    });
    const tools = [...noteTools, ...createDefaultWebTools()];
    return this.factory(cfg, tools, sessionManager);
  }

  private async generateTitle(conversationId: string, userText: string): Promise<void> {
    if (!this.cfg || !userText.trim()) return;
    try {
      const context: Context = {
        systemPrompt: "为下面的用户请求生成简短明确的中文对话标题。只返回标题，不使用 Markdown，不超过 24 个字符。",
        messages: [{ role: "user", content: userText, timestamp: Date.now() }],
      };
      const response = await complete(buildAgentModel(this.cfg), context, {
        apiKey: this.cfg.apiKey,
        maxTokens: 32,
        cacheRetention: "none",
      });
      const title = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .replace(/[\n\r]+/g, " ")
        .replace(/[*_`#>]/g, "")
        .trim()
        .slice(0, 24);
      if (title) this.send({ type: "title", conversationId, title });
    } catch {
      // 标题生成是增强功能；失败不影响持久会话和回复。
    }
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
    return new Promise<string>((resolve, reject) => {
      this.pendingTexts.set(callId, (r) => {
        // `found === false` means the target note does not exist on disk.
        // Reject so tools surface a clear "note not found" error instead of
        // silently operating on (and writing back) an empty document.
        if (!r.found) {
          reject(new Error("目标笔记不存在"));
          return;
        }
        resolve(r.content);
      });
      this.send(msg);
    });
  }

  private requestWrite(
    conversationId: string,
    args: { toolCallId: string; target?: NoteTarget; toolName: string; oldContent: string; newContent: string; preview: EditPreview },
  ): Promise<WriteResult> {
    const callId = `w${++this.writeSeq}`;
    const msg: SidecarToHost = {
      type: "apply_edit",
      callId,
      conversationId,
      toolCallId: args.toolCallId,
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

  private listNotes(conversationId: string): Promise<NoteListEntry[]> {
    const callId = `l${++this.textSeq}`;
    return new Promise((resolve) => {
      this.pendingLists.set(callId, resolve);
      this.send({ type: "list_notes", callId, conversationId });
    });
  }

  private requestCreateNote(conversationId: string, args: { toolCallId: string; title: string; content: string; preview: EditPreview }): Promise<CreateNoteResult> {
    const callId = `c${++this.writeSeq}`;
    return new Promise((resolve) => {
      this.pendingCreates.set(callId, resolve);
      this.send({ type: "create_note", callId, conversationId, toolCallId: args.toolCallId, title: args.title, content: args.content, preview: args.preview });
    });
  }
}

/** Build a real Pi tutor session from config. */
const defaultCreateSession: SessionFactory = async (cfg, tools, sessionManager) => {
  const authStorage = AuthStorage.inMemory();
  if (cfg.apiKey) {
    authStorage.setRuntimeApiKey(buildAgentModel(cfg).provider, cfg.apiKey);
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
    tools: ["read_note", "list_notes", "list_tags", "edit_note", "write_note", "create_note", "set_tag", "tag_create", "tag_update", "tag_delete", "web_search", "web_fetch", "read_skill"],
    noTools: "builtin",
    resourceLoader,
    authStorage,
    modelRegistry,
    sessionManager,
    thinkingLevel: cfg.thinkingLevel,
  });
  return session;
};

export function displayMessagesFromSession(session: SessionLike): ChatDisplayMessage[] {
  const branch = session.sessionManager?.getBranch() ?? [];
  const results = new Map<string, { isError: boolean; error?: string }>();
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as Record<string, unknown>;
    if (message.role !== "toolResult" && message.role !== "tool") continue;
    const callId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    if (!callId) continue;
    const isError = message.isError === true;
    results.set(callId, { isError, ...(isError ? { error: sanitizeToolError(message) } : {}) });
  }
  const output: ChatDisplayMessage[] = [];
  let assistantIndex: number | undefined;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const timestamp = Date.parse(entry.timestamp);
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
    const message = entry.message as { role?: string; content?: unknown };
    if (message.role === "user") {
      assistantIndex = undefined;
      const text = messageText(message);
      if (text) output.push({ role: "user", text, timestamp: safeTimestamp, entryId: entry.id });
      continue;
    }
    if (message.role === "assistant") {
      const blocks = assistantDisplayBlocks(message.content, results);
      if (!blocks.length) continue;
      const current = assistantIndex === undefined ? undefined : output[assistantIndex];
      if (current?.role === "assistant") {
        current.blocks.push(...blocks);
      } else {
        assistantIndex = output.length;
        output.push({ role: "assistant", blocks, timestamp: safeTimestamp, entryId: entry.id });
      }
    }
    // 工具消息仅服务于当前 Agent 上下文，恢复会话时不作为用户可见历史输出。
  }
  return output;
}

function assistantDisplayBlocks(
  content: unknown,
  results: Map<string, { isError: boolean; error?: string }>,
): Extract<ChatDisplayMessage, { role: "assistant" }>["blocks"] {
  const items = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  const output: ChatDisplayBlock[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      output.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking") {
      const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
      if (text) output.push({ type: "thinking", text });
      continue;
    }
    if (block.type === "toolCall") {
      const callId = typeof block.id === "string" ? block.id : typeof block.toolCallId === "string" ? block.toolCallId : undefined;
      const name = typeof block.name === "string" ? block.name : typeof block.toolName === "string" ? block.toolName : undefined;
      if (!callId || !name) continue;
      const args = block.arguments ?? block.args;
      const result = results.get(callId);
      const status = !result ? "incomplete" as const : result.isError ? "failed" as const : "succeeded" as const;
      output.push({
        type: "tool",
        callId,
        name,
        label: formatToolTitle(name, args),
        status,
        ...(status === "failed" && result?.error ? { error: result.error } : {}),
      });
    }
  }
  return output;
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
