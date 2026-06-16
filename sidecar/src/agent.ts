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
import { getModel } from "@earendil-works/pi-ai";
import { createNoteTools, type WriteResult } from "./note-tools.js";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";
import type { HostToSidecar, SidecarToHost } from "./protocol.js";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKey?: string;
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
    const unsubscribe = this.session.subscribe((event) => {
      const msg = translateEvent(req.requestId, event);
      if (msg) this.send(msg);
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

  const model = (getModel as (provider: string, modelId: string) => unknown)(
    cfg.provider,
    cfg.model,
  );

  const { session } = await createAgentSession({
    model: model as never,
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
