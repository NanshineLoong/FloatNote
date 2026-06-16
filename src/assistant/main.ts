import "@phosphor-icons/web/regular";
import { invoke } from "@tauri-apps/api/core";
import { agentSend, onAgentEvent } from "../note/agent";
import { mountAssistant } from "./assistant";

/**
 * 独立助手窗口入口（webview "assistant"）。
 *
 * 发送时向 Rust 查询当前活动笔记（由笔记窗 `set_active_note` 发布），读取其磁盘内容，
 * 再调 `agent_send`。订阅复用 Sprint 3 的 `agent://event`，与嵌入栏天然一致。
 */

interface ActiveNote {
  dir: string;
  noteId: string;
  path: string;
}

const root = document.querySelector<HTMLElement>("#assistant-root")!;

mountAssistant(root, {
  send: async (text) => {
    const active = await invoke<ActiveNote | null>("get_active_note");
    if (!active) return;
    const noteText = await invoke<string>("read_note", { path: active.path });
    await agentSend({
      dir: active.dir,
      noteId: active.noteId,
      path: active.path,
      noteText,
      userText: text,
    });
  },
  subscribe: (cb) => onAgentEvent(cb),
});
