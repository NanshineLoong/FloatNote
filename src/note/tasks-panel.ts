import { invoke } from "@tauri-apps/api/core";
import { readNote } from "./notes-state";
import {
  addTask,
  deleteTask,
  parseTasks,
  serializeTasks,
  toggleTask,
  type TaskLine,
} from "./tasks";

export interface TasksPanelHost {
  /** 当前项目的 _tasks.md 路径，无项目时 null。 */
  tasksPath: () => string | null;
  /** 面板开/关时回调（驱动顶栏按钮高亮）。 */
  onOpenChange: (open: boolean) => void;
}

/** inline 态下「行动」面板与下方助手之间的竖向间隙（px）。 */
const PUSH_GAP = 8;

export function createTasksPanel(parent: HTMLElement, host: TasksPanelHost) {
  let open = false;
  let items: TaskLine[] = [];

  // 与助手共底层：读同一个 `#app` 的 mode 类（inline/floating/closed）决定形态。
  const app = parent.closest<HTMLElement>("#app") ?? document.documentElement;

  const panel = document.createElement("div");
  panel.className = "tasks-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="tasks-head">
      <span class="tasks-title-group">
        <span class="tasks-title">行动</span>
        <span class="tasks-count"></span>
      </span>
      <button class="tasks-add-icon" type="button" aria-label="添加行动"><i class="ph ph-plus"></i></button>
    </div>
    <form class="tasks-add" hidden>
      <span class="tasks-box-ghost" aria-hidden="true"></span>
      <input class="tasks-input" placeholder="下一步是…" />
    </form>
    <div class="tasks-list"></div>
  `;
  parent.appendChild(panel);

  const listEl = panel.querySelector<HTMLElement>(".tasks-list")!;
  const countEl = panel.querySelector<HTMLElement>(".tasks-count")!;
  const addBtn = panel.querySelector<HTMLButtonElement>(".tasks-add-icon")!;
  const form = panel.querySelector<HTMLFormElement>(".tasks-add")!;
  const input = panel.querySelector<HTMLInputElement>(".tasks-input")!;

  async function persist() {
    const path = host.tasksPath();
    if (!path) return;
    await invoke("write_note", { path, content: serializeTasks(items) });
  }

  function draw() {
    listEl.replaceChildren();
    let done = 0;
    let total = 0;
    items.forEach((item, index) => {
      if (item.kind !== "todo") return;
      total += 1;
      if (item.checked) done += 1;

      const row = document.createElement("div");
      row.className = "tasks-row";
      if (item.checked) row.classList.add("done");

      const box = document.createElement("button");
      box.type = "button";
      box.className = "tasks-box";
      box.setAttribute("aria-pressed", String(item.checked));
      box.setAttribute("aria-label", item.checked ? "标记为未完成" : "标记为完成");
      box.innerHTML = `<i class="ph ph-check"></i>`;
      box.onclick = () => mutate(toggleTask(items, index));

      const text = document.createElement("span");
      text.className = "tasks-text";
      text.textContent = item.text || "（未命名行动）";
      // 点文字也能勾选 —— 更大的命中区域。
      text.onclick = () => mutate(toggleTask(items, index));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "tasks-del";
      del.setAttribute("aria-label", "删除这一项");
      del.innerHTML = `<i class="ph ph-trash"></i>`;
      del.onclick = (e) => {
        e.stopPropagation();
        mutate(deleteTask(items, index));
      };

      row.append(box, text, del);
      listEl.appendChild(row);
    });

    countEl.textContent = total ? `· ${done} / ${total}` : "";

    syncLayout();
  }

  /** 应用一次 items 变更：持久化 + 重绘。 */
  function mutate(next: TaskLine[]) {
    items = next;
    void persist();
    draw();
  }

  function setAdding(value: boolean) {
    form.hidden = !value;
    addBtn.classList.toggle("adding", value);
    if (value) {
      input.value = "";
      input.focus();
    }
    syncLayout();
  }

  addBtn.onclick = () => setAdding(!form.hidden);

  form.onsubmit = (e) => {
    e.preventDefault();
    const value = input.value;
    if (!value.trim()) {
      setAdding(false);
      return;
    }
    items = addTask(items, value);
    void persist();
    draw();
    // 连续录入：保存后清空并保持输入框聚焦。
    input.value = "";
    input.focus();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setAdding(false);
    }
  });
  input.addEventListener("blur", () => {
    // 失焦且为空 → 收回成按钮；有内容则留着等提交。
    if (!input.value.trim()) setAdding(false);
  });

  /**
   * inline 态把面板自身高度写进 `--action-h`，下方助手据此下推（CSS 里
   * `#app.mode-inline #assistant-region { top: var(--action-h) }`）。
   * floating/closed 态不下推 —— 助手在右下角，与右上角的行动面板不冲突。
   */
  function syncLayout() {
    const inline = open && app.classList.contains("mode-inline");
    // 面板顶部 8px 偏移也计入，否则助手会贴到面板底部、吃掉间隙。
    const h = inline ? panel.offsetTop + panel.offsetHeight + PUSH_GAP : 0;
    app.style.setProperty("--action-h", `${h}px`);
  }

  // 面板尺寸随内容 / 窗宽变化时自动重算下推高度。
  const ro = new ResizeObserver(() => syncLayout());
  ro.observe(panel);

  async function reload() {
    const path = host.tasksPath();
    if (!path) {
      items = [];
      draw();
      return;
    }
    try {
      items = parseTasks(await readNote(path));
    } catch {
      // _tasks.md 尚未落盘（新建项目只 scaffold inbox，任务文件懒创建）→ 当作空。
      items = [];
    }
    draw();
  }

  function toggle() {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    if (!open) setAdding(false);
    host.onOpenChange(open);
    syncLayout();
    if (open) void reload();
  }

  return { toggle, reload, syncLayout };
}
