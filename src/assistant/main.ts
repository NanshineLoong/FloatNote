import "@phosphor-icons/web/regular";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
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

setupClickThrough();

/**
 * 透明窗的「空隙鼠标穿透」：只有气泡 / 机器人 / 输入框等实心元素拦截鼠标，
 * 其余透明区域把鼠标事件放给后面的应用。
 *
 * 难点：一旦开启穿透，本窗口就收不到 mousemove 了。所以两段式——
 * 交互态用 mousemove 检测「移到空隙」→ 开穿透；穿透态轮询系统光标位置，
 * 检测「移回实心元素」→ 关穿透恢复交互。
 */
function setupClickThrough() {
  const SOLID = ".chat-msg, .chat-tool, .chat-error, .assistant-bot, .assistant-input, .assistant-send";
  const win = getCurrentWindow();
  let ignoring = false;
  let pollTimer: number | undefined;

  const overSolid = (x: number, y: number) =>
    !!document.elementFromPoint(x, y)?.closest(SOLID);

  async function setIgnore(next: boolean) {
    if (next === ignoring) return;
    ignoring = next;
    await win.setIgnoreCursorEvents(next);
    if (next) startPoll();
    else stopPoll();
  }

  function stopPoll() {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = window.setInterval(async () => {
      if (!ignoring) return stopPoll();
      try {
        const [pos, scale, cur] = await Promise.all([
          win.outerPosition(),
          win.scaleFactor(),
          cursorPosition(),
        ]);
        // 系统光标（物理像素）→ 窗口内 CSS 像素（无边框，故 outer 即内容左上角）。
        const localX = (cur.x - pos.x) / scale;
        const localY = (cur.y - pos.y) / scale;
        if (overSolid(localX, localY)) void setIgnore(false);
      } catch {
        /* 取位失败则下个 tick 再试 */
      }
    }, 90);
  }

  void win.setIgnoreCursorEvents(false);
  document.addEventListener("mousemove", (e) => {
    if (ignoring) return;
    if (!overSolid(e.clientX, e.clientY)) void setIgnore(true);
  });
}
