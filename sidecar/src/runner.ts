import { complete } from "@earendil-works/pi-ai/compat";
import { existsSync, rmSync } from "node:fs";
import type { Context } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
  type InlineExtension,
  type SessionManager as PiSessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createPermissionExtension } from "./extensions/permission-extension.js";
import { createTagExtension, createTagTools } from "./extensions/tag-extension.js";
import { createWebExtension } from "./extensions/web-extension.js";
import { createWorkspaceExtension, createWorkspaceTools } from "./extensions/workspace-extension.js";
import { createDefaultWebTools } from "./web-tools.js";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";
import { SessionSkillView, SkillRegistry, type SkillSnapshot } from "./skills.js";
import type { ChatDisplayBlock, ChatDisplayMessage, HostToSidecar, PromptRef, SidecarToHost, WorkspaceEntry } from "./protocol.js";
import { buildAgentModel, resolveAgentConfig, sanitizeAgentError, type AgentConfig } from "./model.js";
import { translateEvent } from "./event-translate.js";
import { composePromptText } from "./prompt-compose.js";
import { formatToolTitle, sanitizeToolError } from "./tool-title.js";
import { buildOneShotContext } from "./one-shot.js";
import { MutationCoordinator } from "./workspace/mutation-coordinator.js";
import { WorkspaceClient, type PreparedMutation } from "./workspace/types.js";

/** Minimal surface of a Pi AgentSession the runner depends on (injectable for tests). */
export interface SessionLike {
  sessionFile?: string;
  sessionManager?: Pick<PiSessionManager, "getBranch" | "getSessionFile">;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  reload(): Promise<void>;
  /** Navigate through the session tree and rebuild Pi's in-memory model context. */
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<{ cancelled: boolean }>;
  abort(): Promise<void>;
  dispose?: () => void;
}

export type SessionFactory = (
  cfg: AgentConfig,
  tools: ToolDefinition[],
  sessionManager: PiSessionManager,
  resources: SessionResources,
) => Promise<SessionLike>;

export interface SessionResources {
  skillView: SessionSkillView;
  extensions: InlineExtension[];
}

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

const EMPTY_RESPONSE_MESSAGE = "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。";
export const ACTIVE_TOOL_NAMES = [
  "ls", "read", "find", "grep", "edit", "write", "create_piece",
  "list_tags", "tag_text", "tag_create", "tag_update", "tag_delete",
  "web_search", "web_fetch",
] as const;

interface PendingCall<T> {
  conversationId: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
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
  private readonly sessionManagers = new Map<string, PiSessionManager>();
  private readonly skillRegistry = new SkillRegistry();
  private readonly skillViews = new Map<string, SessionSkillView>();
  private readonly dirtySkillSessions = new Map<string, SkillSnapshot>();
  private readonly activeConversations = new Map<string, string>();
  private readonly discardedConversations = new Set<string>();
  private readonly mutationCoordinators = new Map<string, MutationCoordinator>();
  private callSeq = 0;
  private readonly pendingWorkspaceLists = new Map<string, PendingCall<WorkspaceEntry[]>>();
  private readonly pendingWorkspaceReads = new Map<string, PendingCall<string>>();
  private readonly pendingMutationReviews = new Map<string, PendingCall<Extract<HostToSidecar, { type: "mutation_review_result" }>>>();
  private readonly pendingMutationCommits = new Map<string, PendingCall<Extract<HostToSidecar, { type: "mutation_commit_result" }>>>();

  constructor(options: AgentRunnerOptions) {
    this.send = options.send;
    this.factory = options.createSession ?? defaultCreateSession;
  }

  async configure(cfg: AgentConfig): Promise<void> {
    if (this.activeConversations.size > 0) {
      throw new Error("请等待当前回复完成后再切换 AI 提供商");
    }
    const resolved = resolveAgentConfig(cfg);
    const replacements = new Map<string, {
      session: SessionLike;
      skillView: SessionSkillView;
      coordinator: MutationCoordinator;
    }>();
    try {
      for (const [conversationId, sessionManager] of this.sessionManagers) {
        replacements.set(conversationId, await this.createConfiguredSession(resolved, conversationId, sessionManager));
      }
    } catch (error) {
      for (const replacement of replacements.values()) replacement.session.dispose?.();
      throw error;
    }
    for (const [conversationId, { session: replacement, skillView, coordinator }] of replacements) {
      this.sessions.get(conversationId)?.dispose?.();
      this.sessions.set(conversationId, replacement);
      this.skillViews.set(conversationId, skillView);
      this.mutationCoordinators.get(conversationId)?.clear();
      this.mutationCoordinators.set(conversationId, coordinator);
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
    this.skillViews.clear();
    this.dirtySkillSessions.clear();
    for (const coordinator of this.mutationCoordinators.values()) coordinator.clear();
    this.mutationCoordinators.clear();
    this.rejectAllPending("AI 配置已关闭");
    this.cfg = undefined;
  }

  /** Deliver one trusted Skill generation and reload sessions without partial views. */
  async setSkillPaths(paths: string[], disabledSkillNames: string[] = []): Promise<void> {
    const next = this.skillRegistry.replace(paths, disabledSkillNames);
    const activeConversationIds = new Set(this.activeConversations.values());
    for (const [conversationId, session] of this.sessions) {
      if (activeConversationIds.has(conversationId)) {
        this.dirtySkillSessions.set(conversationId, next);
        continue;
      }
      const view = this.skillViews.get(conversationId);
      if (!view) continue;
      view.replace(next);
      await session.reload();
    }
  }

  /** Synchronous enumeration of loaded skills (no host round-trip). */
  listSkills(): { name: string; description: string }[] {
    return this.skillRegistry.snapshot().summaries();
  }

  async oneShot(task: string, input: string): Promise<string> {
    if (!this.cfg) throw new Error("尚未配置或启用 AI 提供商");
    const response = await complete(buildAgentModel(this.cfg), buildOneShotContext(task, input), {
      apiKey: this.cfg.apiKey,
      cacheRetention: "none",
    });
    const result = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!result) throw new Error("翻译结果为空");
    return result;
  }

  async newSession(req: NewSessionRequest): Promise<void> {
    this.discardedConversations.delete(req.conversationId);
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

  discardSession(conversationId: string): void {
    this.discardedConversations.add(conversationId);
    this.sessions.get(conversationId)?.dispose?.();
    this.sessions.delete(conversationId);
    this.sessionManagers.delete(conversationId);
    this.skillViews.delete(conversationId);
    this.dirtySkillSessions.delete(conversationId);
    this.mutationCoordinators.get(conversationId)?.clear();
    this.mutationCoordinators.delete(conversationId);
    this.rejectConversationCalls(conversationId, "对话已关闭");
    for (const [requestId, activeConversationId] of this.activeConversations) {
      if (activeConversationId === conversationId) this.activeConversations.delete(requestId);
    }
  }

  async prompt(req: PromptRequest): Promise<void> {
    const session = this.sessions.get(req.conversationId);
    if (!session) {
      throw new Error("conversation session not opened");
    }
    let sawVisibleOutput = false;
    // Pi 的 contentIndex 会在一次工具调用后的新 assistant message 中重置，
    // 因此不能直接把它当作整次请求内的 thinking 块唯一标识。
    let thinkingBlockSeq = 0;
    const unsubscribe = session.subscribe((event) => {
      let msg = translateEvent(req.requestId, req.conversationId, event);
      if (!msg) return;
      if (msg.type === "thinking_start") {
        msg = { ...msg, blockId: `${req.requestId}-t${thinkingBlockSeq++}` };
      }
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
      const stillActive = [...this.activeConversations.values()].includes(req.conversationId);
      const next = this.dirtySkillSessions.get(req.conversationId);
      if (!stillActive && next) {
        const view = this.skillViews.get(req.conversationId);
        if (view) {
          view.replace(next);
          await session.reload();
        }
        this.dirtySkillSessions.delete(req.conversationId);
      }
    }
  }

  /** Rewind before a user turn and rebuild Pi's in-memory context for the new branch. */
  async rewind(conversationId: string, userEntryId: string): Promise<void> {
    if (this.activeConversations.size > 0) {
      throw new Error("cannot rewind while an assistant response is streaming");
    }
    const session = this.sessions.get(conversationId);
    if (!session) throw new Error("conversation session not opened");
    const result = await session.navigateTree(userEntryId, { summarize: false });
    if (result.cancelled) throw new Error("conversation rewind was cancelled");
    // Persist the newly active branch even if the following retry fails before it can append a turn.
    this.emitSessionSynced(conversationId);
  }

  onWorkspaceListResult(msg: Extract<HostToSidecar, { type: "workspace_list_result" }>): void {
    this.settle(this.pendingWorkspaceLists, msg.callId, msg.entries, msg.error);
  }

  onWorkspaceReadResult(msg: Extract<HostToSidecar, { type: "workspace_read_result" }>): void {
    this.settle(
      this.pendingWorkspaceReads,
      msg.callId,
      msg.content ?? "",
      msg.error ?? (!msg.found ? "目标笔记不存在" : undefined),
    );
  }

  onMutationReviewResult(msg: Extract<HostToSidecar, { type: "mutation_review_result" }>): void {
    this.settle(this.pendingMutationReviews, msg.callId, msg);
  }

  onMutationCommitResult(msg: Extract<HostToSidecar, { type: "mutation_commit_result" }>): void {
    this.settle(this.pendingMutationCommits, msg.callId, msg);
  }

  /** Cancel the in-flight prompt for `requestId`. Scoped to that request's
   *  conversation only — other conversations keep streaming. No-op when the
   *  request is unknown (already finished or never started). */
  async cancel(requestId?: string): Promise<void> {
    const conversationId = requestId ? this.activeConversations.get(requestId) : undefined;
    if (!conversationId) return;
    await this.sessions.get(conversationId)?.abort();
    this.mutationCoordinators.get(conversationId)?.clear();
    this.rejectConversationCalls(conversationId, "工具调用已取消");
  }

  private async installSession(conversationId: string, sessionManager: PiSessionManager): Promise<void> {
    if (!this.cfg) {
      throw new Error("尚未配置或启用 AI 提供商，请前往设置完成配置并启用。");
    }
    const { session, skillView, coordinator } = await this.createConfiguredSession(
      this.cfg,
      conversationId,
      sessionManager,
    );
    if (this.discardedConversations.has(conversationId)) {
      session.dispose?.();
      const orphan = session.sessionFile ?? session.sessionManager?.getSessionFile() ?? sessionManager.getSessionFile();
      if (orphan) rmSync(orphan, { force: true });
      throw new Error("conversation session discarded during installation");
    }
    this.sessions.get(conversationId)?.dispose?.();
    this.sessionManagers.set(conversationId, sessionManager);
    this.sessions.set(conversationId, session);
    this.skillViews.set(conversationId, skillView);
    this.mutationCoordinators.get(conversationId)?.clear();
    this.mutationCoordinators.set(conversationId, coordinator);
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
  ): Promise<{
    session: SessionLike;
    skillView: SessionSkillView;
    coordinator: MutationCoordinator;
  }> {
    const skillView = this.skillViews.get(conversationId)
      ?? new SessionSkillView(this.skillRegistry.snapshot());
    const workspace = new WorkspaceClient({
      list: () => this.listWorkspace(conversationId),
      read: (path) => this.readWorkspace(conversationId, path),
    }, skillView);
    const coordinator = new MutationCoordinator({
      workspace,
      review: (toolCallId, toolName, mutation) => this.reviewMutation(
        conversationId,
        toolCallId,
        toolName,
        mutation,
      ),
      commit: (toolCallId, lease) => this.commitMutation(
        conversationId,
        toolCallId,
        lease,
      ),
    });
    const workspaceTools = createWorkspaceTools(workspace, coordinator);
    const tagTools = createTagTools(workspace, coordinator);
    const webTools = createDefaultWebTools();
    const tools = [...workspaceTools, ...tagTools, ...webTools];
    const extensions = [
      createWorkspaceExtension(workspaceTools),
      createTagExtension(tagTools),
      createWebExtension(),
      createPermissionExtension(coordinator),
    ];
    const session = await this.factory(cfg, tools, sessionManager, { skillView, extensions });
    return { session, skillView, coordinator };
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

  private listWorkspace(conversationId: string): Promise<WorkspaceEntry[]> {
    const callId = this.nextCallId("l");
    return new Promise((resolve, reject) => {
      this.pendingWorkspaceLists.set(callId, { conversationId, resolve, reject });
      this.send({ type: "workspace_list", callId, conversationId });
    });
  }

  private readWorkspace(conversationId: string, path: string): Promise<string> {
    const callId = this.nextCallId("r");
    return new Promise((resolve, reject) => {
      this.pendingWorkspaceReads.set(callId, { conversationId, resolve, reject });
      this.send({ type: "workspace_read", callId, conversationId, path });
    });
  }

  private reviewMutation(
    conversationId: string,
    toolCallId: string,
    toolName: string,
    mutation: PreparedMutation,
  ): Promise<Extract<HostToSidecar, { type: "mutation_review_result" }>> {
    const callId = this.nextCallId("v");
    return new Promise((resolve, reject) => {
      this.pendingMutationReviews.set(callId, { conversationId, resolve, reject });
      this.send({
        type: "review_mutation",
        callId,
        conversationId,
        toolCallId,
        toolName,
        ...mutation,
      });
    });
  }

  private commitMutation(
    conversationId: string,
    toolCallId: string,
    lease: string,
  ): Promise<Extract<HostToSidecar, { type: "mutation_commit_result" }>> {
    const callId = this.nextCallId("m");
    return new Promise((resolve, reject) => {
      this.pendingMutationCommits.set(callId, { conversationId, resolve, reject });
      this.send({ type: "commit_mutation", callId, conversationId, toolCallId, lease });
    });
  }

  private nextCallId(prefix: string): string {
    return `${prefix}${++this.callSeq}`;
  }

  private settle<T>(
    pending: Map<string, PendingCall<T>>,
    callId: string,
    value: T,
    error?: string,
  ): void {
    const call = pending.get(callId);
    if (!call) return;
    pending.delete(callId);
    if (error) call.reject(new Error(error));
    else call.resolve(value);
  }

  private rejectConversationCalls(conversationId: string, message: string): void {
    for (const pending of this.pendingMaps()) {
      for (const [callId, call] of pending) {
        if (call.conversationId !== conversationId) continue;
        pending.delete(callId);
        call.reject(new Error(message));
      }
    }
  }

  private rejectAllPending(message: string): void {
    for (const pending of this.pendingMaps()) {
      for (const call of pending.values()) call.reject(new Error(message));
      pending.clear();
    }
  }

  private pendingMaps(): Array<Map<string, PendingCall<unknown>>> {
    return [
      this.pendingWorkspaceLists,
      this.pendingWorkspaceReads,
      this.pendingMutationReviews,
      this.pendingMutationCommits,
    ] as Array<Map<string, PendingCall<unknown>>>;
  }
}

/** Build a real Pi tutor session from config. */
const defaultCreateSession: SessionFactory = async (cfg, _tools, sessionManager, resources) => {
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
    extensionFactories: resources.extensions,
    skillsOverride: () => ({ skills: resources.skillView.skills(), diagnostics: [] }),
    systemPromptOverride: () => TUTOR_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  const model = buildAgentModel(cfg);

  const { session } = await createAgentSession({
    model,
    tools: [...ACTIVE_TOOL_NAMES],
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
