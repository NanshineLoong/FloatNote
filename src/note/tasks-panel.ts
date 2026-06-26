import { invoke } from "@tauri-apps/api/core";
import { readNote } from "./notes-state";
import { addTask, parseTasks, serializeTasks, toggleTask, type TaskLine } from "./tasks";

export interface TasksPanelHost {
  /** 当前项目的 _tasks.md 路径，无项目时 null。 */
  tasksPath: () => string | null;
  /** 面板开/关时回调（驱动顶栏按钮高亮）。 */
  onOpenChange: (open: boolean) => void;
}

export function createTasksPanel(parent: HTMLElement, host: TasksPanelHost) {
  let open = false;
  let items: TaskLine[] = [];

  const panel = document.createElement("div");
  panel.className = "tasks-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="tasks-head">清单</div>
    <div class="tasks-list"></div>
    <form class="tasks-add">
      <input class="tasks-input" placeholder="添加下一步…" />
    </form>
  `;
  parent.appendChild(panel);

  const listEl = panel.querySelector<HTMLElement>(".tasks-list")!;
  const form = panel.querySelector<HTMLFormElement>(".tasks-add")!;
  const input = panel.querySelector<HTMLInputElement>(".tasks-input")!;

  async function persist() {
    const path = host.tasksPath();
    if (!path) return;
    await invoke("write_note", { path, content: serializeTasks(items) });
  }

  function draw() {
    listEl.replaceChildren();
    items.forEach((item, index) => {
      if (item.kind !== "todo") return;
      const row = document.createElement("label");
      row.className = "tasks-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = item.checked;
      box.onchange = () => {
        items = toggleTask(items, index);
        void persist();
        draw();
      };
      const text = document.createElement("span");
      text.className = "tasks-text";
      if (item.checked) text.classList.add("done");
      text.textContent = item.text || "（空任务）";
      row.append(box, text);
      listEl.appendChild(row);
    });
    if (!items.some((i) => i.kind === "todo")) {
      const empty = document.createElement("div");
      empty.className = "tasks-empty";
      empty.textContent = "还没有下一步。";
      listEl.appendChild(empty);
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    items = addTask(items, input.value);
    input.value = "";
    void persist();
    draw();
  };

  async function reload() {
    const path = host.tasksPath();
    items = path ? parseTasks(await readNote(path)) : [];
    draw();
  }

  function toggle() {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    host.onOpenChange(open);
    if (open) void reload();
  }

  return { toggle, reload };
}
