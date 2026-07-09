import { loadNote, saveImmediate } from "./notes-state";
import {
  addTask,
  deleteTask,
  parseTasks,
  reorderTask,
  renameTask,
  serializeTasks,
  toggleTask,
  type TaskLine,
} from "@floatnote/note-logic";

export interface TasksPanelHost {
  /** 当前项目的 _tasks.md 路径，无项目时 null。 */
  tasksPath: () => string | null;
  /** 面板开/关时回调（驱动顶栏按钮高亮）。 */
  onOpenChange: (open: boolean) => void;
}

/** 窗口模式：项目（含 _tasks.md）或独立文档（无 _tasks.md）。 */
export type WindowMode = "project" | "document";

/**
 * 项目↔文档切换时行动面板的目标状态。独立文档无 _tasks.md，进入文档模式时把行动
 * 「临时遮挡」——记下当时的开关并关掉，返回项目时按记忆恢复。项目→项目、文档→文档
 * 不变。`remember` 仅在项目→文档时非 null，为调用方写入「离开项目land时的开关」。
 */
export function actionTargetForTransition(args: {
  from: WindowMode;
  to: WindowMode;
  currentOpen: boolean;
  rememberedOpen: boolean;
}): { open: boolean; remember: boolean | null } {
  const { from, to, currentOpen, rememberedOpen } = args;
  // 项目 → 文档：记下当前开关，关掉面板（文档无 _tasks.md）。
  if (from === "project" && to === "document") {
    return { open: false, remember: currentOpen };
  }
  // 文档 → 项目：按离开项目时记下的开关恢复。
  if (from === "document" && to === "project") {
    return { open: rememberedOpen, remember: null };
  }
  // 同模式切换（项目间 / 文档间）：保持原样，不触碰记忆。
  return { open: currentOpen, remember: null };
}

/** inline 态下「行动」面板与下方助手之间的竖向间隙（px）。 */
const PUSH_GAP = 8;

/** 拖拽阈值：按下后移动超过该距离才进入拖拽，否则放行 click（切换完成态）。 */
const DRAG_THRESHOLD = 4;

export function createTasksPanel(parent: HTMLElement, host: TasksPanelHost) {
  let open = false;
  let items: TaskLine[] = [];
  /** true = 只看未完成；false = 显示全部。仅影响视图，不落盘。 */
  let filterIncomplete = false;
  /** 正在内联重命名的 todo 的真实 items 索引；-1 表示未在编辑。 */
  let editingIndex = -1;

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
      <span class="tasks-head-actions">
        <button class="tasks-filter" type="button" aria-pressed="false" aria-label="筛选未完成" title="只看未完成"><i class="ph ph-circle-dashed"></i></button>
        <button class="tasks-add-icon" type="button" aria-label="添加行动"><i class="ph ph-plus"></i></button>
      </span>
    </div>
    <div class="tasks-list"></div>
    <form class="tasks-add" hidden>
      <span class="tasks-box-ghost" aria-hidden="true"></span>
      <input class="tasks-input" placeholder="下一步是…" />
    </form>
  `;
  parent.appendChild(panel);

  const listEl = panel.querySelector<HTMLElement>(".tasks-list")!;
  const countEl = panel.querySelector<HTMLElement>(".tasks-count")!;
  const addBtn = panel.querySelector<HTMLButtonElement>(".tasks-add-icon")!;
  const filterBtn = panel.querySelector<HTMLButtonElement>(".tasks-filter")!;
  const form = panel.querySelector<HTMLFormElement>(".tasks-add")!;
  const input = panel.querySelector<HTMLInputElement>(".tasks-input")!;

  /** 三点菜单与重命名编辑态共用一份「点击外部即收起」逻辑。 */
  let menuEl: HTMLElement | null = null;

  async function persist() {
    const path = host.tasksPath();
    if (!path) return;
    await saveImmediate(path, serializeTasks(items));
  }

  /** 当前是否应该渲染某条 todo：filter 开时隐藏已完成项。 */
  function shouldRender(item: TaskLine): item is { kind: "todo"; checked: boolean; text: string } {
    return item.kind === "todo" && (!filterIncomplete || !item.checked);
  }

  function draw() {
    listEl.replaceChildren();
    let done = 0;
    let total = 0;

    items.forEach((item, index) => {
      if (item.kind !== "todo") return;
      total += 1;
      if (item.checked) done += 1;
      if (!shouldRender(item)) return;

      const row = document.createElement("div");
      row.className = "tasks-row";
      row.dataset.index = String(index);
      if (item.checked) row.classList.add("done");
      if (index === editingIndex) row.classList.add("editing");

      const box = document.createElement("button");
      box.type = "button";
      box.className = "tasks-box";
      box.setAttribute("aria-pressed", String(item.checked));
      box.setAttribute("aria-label", item.checked ? "标记为未完成" : "标记为完成");
      box.innerHTML = `<i class="ph ph-check"></i>`;
      box.onclick = (e) => {
        e.stopPropagation();
        if (consumeDragClick()) return;
        mutate(toggleTask(items, index));
      };

      // 编辑态：文本位变成 input；否则是可点击切换的 span。
      if (index === editingIndex) {
        const editInput = document.createElement("input");
        editInput.className = "tasks-edit-input";
        editInput.value = item.text;
        editInput.setAttribute("aria-label", "重命名行动");
        const commit = () => {
          const next = renameTask(items, index, editInput.value);
          editingIndex = -1;
          mutate(next);
        };
        const cancel = () => {
          editingIndex = -1;
          draw();
        };
        editInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        });
        editInput.addEventListener("blur", () => commit());
        // 挂载后聚焦并全选 —— 放在下个帧，确保已入 DOM。
        requestAnimationFrame(() => {
          editInput.focus();
          editInput.select();
        });
        row.append(box, editInput);
      } else {
        const text = document.createElement("span");
        text.className = "tasks-text";
        text.textContent = item.text || "（未命名行动）";
        // 点文字也能勾选 —— 更大的命中区域。
        text.onclick = (e) => {
          e.stopPropagation();
          if (consumeDragClick()) return;
          mutate(toggleTask(items, index));
        };

        const more = document.createElement("button");
        more.type = "button";
        more.className = "tasks-more";
        more.setAttribute("aria-label", "更多操作");
        more.innerHTML = `<i class="ph ph-dots-three-vertical"></i>`;
        more.onclick = (e) => {
          e.stopPropagation();
          if (consumeDragClick()) return;
          openMenu(more, index);
        };

        row.append(box, text, more);
      }

      attachDrag(row, index);
      listEl.appendChild(row);
    });

    if (total === 0 && filterIncomplete) {
      const empty = document.createElement("div");
      empty.className = "tasks-empty";
      empty.textContent = "没有未完成的行动";
      listEl.appendChild(empty);
    }

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

  addBtn.onclick = () => setAdding(form.hidden);

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
    // 新项落在最下方 → 滚到底露出它；连续录入保持聚焦。
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });
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

  filterBtn.onclick = () => {
    filterIncomplete = !filterIncomplete;
    filterBtn.setAttribute("aria-pressed", String(filterIncomplete));
    filterBtn.classList.toggle("active", filterIncomplete);
    filterBtn.title = filterIncomplete ? "显示全部" : "只看未完成";
    draw();
  };

  // ── 三点菜单 ───────────────────────────────────────────────
  function openMenu(anchor: HTMLElement, index: number) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "tasks-menu";
    menu.innerHTML = `
      <button class="tasks-menu-item" type="button" data-act="rename"><i class="ph ph-pencil-simple-line"></i>重命名</button>
      <button class="tasks-menu-item danger" type="button" data-act="delete"><i class="ph ph-trash"></i>删除</button>
    `;
    menu.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      closeMenu();
      if (act === "rename") {
        editingIndex = index;
        draw();
      } else if (act === "delete") {
        mutate(deleteTask(items, index));
      }
    });
    panel.appendChild(menu);
    menuEl = menu;
    // 定位到锚点左下；menu 是 panel 的绝对定位子元素，需用 panel 相对坐标。
    const ar = anchor.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect(); // 先挂载才能量宽
    let left = ar.right - pr.left - menuRect.width - 6;
    let top = ar.bottom - pr.top + 4;
    if (left < 4) left = 4;
    // 向下溢出 panel → 改在锚点上方展开。
    if (top + menuRect.height > pr.height) top = ar.top - pr.top - menuRect.height - 4;
    if (top < 4) top = 4;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    // 下一帧外部点击关闭（避免本次点击立即触发）。
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onMenuOutside, true);
      document.addEventListener("keydown", onMenuEsc, true);
    });
  }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener("pointerdown", onMenuOutside, true);
    document.removeEventListener("keydown", onMenuEsc, true);
  }
  function onMenuOutside(e: PointerEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
  }
  function onMenuEsc(e: KeyboardEvent) {
    if (e.key === "Escape") closeMenu();
  }

  // ── 拖拽排序（阈值拖拽，整行为手柄） ───────────────────────
  let dragState: {
    from: number;
    row: HTMLElement;
    ghost: HTMLElement;
    to: number;
    moved: boolean;
  } | null = null;
  /** 拖拽刚结束的那次 click 应被吞掉，避免误触发切换。 */
  let suppressClick = false;
  function consumeDragClick(): boolean {
    if (suppressClick) {
      suppressClick = false;
      return true;
    }
    return false;
  }

  function attachDrag(row: HTMLElement, index: number) {
    row.addEventListener("pointerdown", (e) => {
      // 先清掉可能残留的抑制标志（上一次拖拽未产生 click 时会遗留）。
      suppressClick = false;
      // 编辑态、或在按钮上按下，不启动拖拽（交给按钮自身处理）。
      if (editingIndex === index) return;
      const target = e.target as HTMLElement;
      if (target.closest(".tasks-box, .tasks-more, .tasks-edit-input")) return;
      if (e.button !== 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let active = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!active) {
          active = true;
          startDrag(row, index, ev);
        }
        if (active && dragState) updateDrag(ev);
      };
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (active && dragState) {
          endDrag();
          // 拖拽产生的 pointerup 之后会跟一个 click；吞掉它。
          suppressClick = true;
        }
        void ev;
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function startDrag(row: HTMLElement, index: number, ev: PointerEvent) {
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.add("tasks-ghost");
    ghost.style.position = "fixed";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "50";
    ghost.style.width = `${row.offsetWidth}px`;
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    ghost.style.transform = "translate(-50%, -50%)";
    document.body.appendChild(ghost);
    row.classList.add("dragging");
    document.body.style.userSelect = "none";
    dragState = { from: index, row, ghost, to: index, moved: false };
  }

  function updateDrag(ev: PointerEvent) {
    if (!dragState) return;
    dragState.ghost.style.left = `${ev.clientX}px`;
    dragState.ghost.style.top = `${ev.clientY}px`;

    // 清掉旧的高亮，再算新落点。
    listEl.querySelectorAll<HTMLElement>(".tasks-row").forEach((r) => {
      r.classList.remove("drop-before", "drop-after");
    });

    const rows = Array.from(listEl.querySelectorAll<HTMLElement>(".tasks-row"));
    // 指针下方的行；找不到则落在最后一行之后。
    let target: HTMLElement | null = null;
    let half: "before" | "after" = "after";
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (ev.clientY < rect.top - rect.height / 2) {
        target = r;
        half = "before";
        break;
      }
      if (ev.clientY >= rect.top - rect.height / 2 && ev.clientY < rect.bottom + rect.height / 2) {
        // 在该行范围内：上半 before，下半 after。
        target = r;
        const mid = rect.top + rect.height / 2;
        half = ev.clientY < mid ? "before" : "after";
        break;
      }
      target = r;
      half = "after";
    }
    if (!target) return;

    const rIdx = Number(target.dataset.index);
    const from = dragState.from;
    let to: number;
    if (half === "before") {
      to = from < rIdx ? rIdx - 1 : rIdx;
    } else {
      to = from <= rIdx ? rIdx : rIdx + 1;
    }
    // 越界钳到末位。
    if (to < 0) to = 0;
    if (to > items.length - 1) to = items.length - 1;
    dragState.to = to;
    dragState.moved = to !== from;
    target.classList.add(half === "before" ? "drop-before" : "drop-after");
  }

  function endDrag() {
    if (!dragState) return;
    const { from, to, moved, ghost, row } = dragState;
    ghost.remove();
    row.classList.remove("dragging");
    listEl.querySelectorAll<HTMLElement>(".tasks-row").forEach((r) => {
      r.classList.remove("drop-before", "drop-after");
    });
    document.body.style.userSelect = "";
    dragState = null;
    if (moved && from !== to) {
      mutate(reorderTask(items, from, to));
    }
  }

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
      items = parseTasks(await loadNote(path));
    } catch {
      // _tasks.md 尚未落盘（新建项目只 scaffold inbox，任务文件懒创建）→ 当作空。
      items = [];
    }
    draw();
  }

  /** 程序化开/关到指定状态。已是目标状态时为 no-op（不触发 onOpenChange / 不 reload）。 */
  function setOpen(target: boolean) {
    if (open === target) return;
    open = target;
    panel.style.display = open ? "flex" : "none";
    if (!open) {
      setAdding(false);
      closeMenu();
      editingIndex = -1;
    }
    host.onOpenChange(open);
    syncLayout();
    if (open) void reload();
  }

  function toggle() {
    setOpen(!open);
  }

  function isOpen() {
    return open;
  }

  return { toggle, setOpen, isOpen, reload, syncLayout };
}
