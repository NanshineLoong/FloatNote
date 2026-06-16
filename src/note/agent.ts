import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 前端 ↔ Rust agent 桥接（Sprint 3）。
 *
 * `agent://event` 转发的是 sidecar→host 协议消息（delta / tool / done / error / ready）；
 * `note://updated` 是 AI 改写笔记后 Rust 广播的热刷新事件。类型与协议保持一致。
 */

/** sidecar → host 事件（经 Rust 原样转发到 `agent://event`）。 */
export type AgentEvent =
  | { type: "ready" }
  | { type: "delta"; requestId: string; text: string }
  | { type: "tool"; requestId: string; name: string; phase: "start" | "end" }
  | { type: "done"; requestId: string }
  | { type: "error"; requestId: string | null; message: string };

/** AI 改写笔记后 Rust 广播的载荷。 */
export interface NoteUpdated {
  noteId: string;
  path: string;
  version: number;
}

/** 配置 sidecar 的 provider / model / key。 */
export function agentConfigure(
  provider: string,
  model: string,
  apiKey?: string,
): Promise<void> {
  return invoke<void>("agent_configure", { provider, model, apiKey });
}

/** 发一条用户消息给 tutor，返回 requestId。 */
export function agentSend(args: {
  dir: string;
  noteId: string;
  path: string;
  noteText: string;
  userText: string;
}): Promise<string> {
  return invoke<string>("agent_send", args);
}

/** 取消进行中的对话。 */
export function agentCancel(requestId: string): Promise<void> {
  return invoke<void>("agent_cancel", { requestId });
}

/** 订阅 agent 流式事件；返回取消订阅函数。 */
export function onAgentEvent(cb: (event: AgentEvent) => void): Promise<UnlistenFn> {
  return listen<AgentEvent>("agent://event", (event) => cb(event.payload));
}

/** 订阅笔记被 AI 改写的热刷新事件；返回取消订阅函数。 */
export function onNoteUpdated(cb: (payload: NoteUpdated) => void): Promise<UnlistenFn> {
  return listen<NoteUpdated>("note://updated", (event) => cb(event.payload));
}
