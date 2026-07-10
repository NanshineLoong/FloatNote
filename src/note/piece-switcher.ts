import { sanitizePieceStem } from "./piece-name";
import {
  confirmDialog,
  createNote,
  deleteNote,
  listPieces,
  renameNote,
  type NoteEntry,
} from "./notes-state";
import { formatVersionLabel, type VersionEntry } from "./versions";
import { createIcon } from "../shared/ui/icon";

export interface PieceHeaderHost {
  /** 当前项目文件夹路径。 */
  dir: () => string;
  /** 当前成品（用于高亮 / 重命名旧名）。 */
  current: () => NoteEntry | null;
  /** 切到某成品（switch / 新建 / 重命名后）。 */
  open: (entry: NoteEntry) => void;
  /** 读取当前成品的版本列表。 */
  loadVersions: () => Promise<VersionEntry[]>;
  /** 手动记录当前成品为一个新版本。 */
  snapshot: () => Promise<void>;
  /** 恢复当前成品到版本 v（恢复前当前内容已自动存为新版本）。 */
  restore: (v: number) => Promise<void>;
  /** 删完当前 piece 后项目里已无 piece；切到 NO_PIECE 空态而非自动建空文件。 */
  onEmptied?: () => void;
  /** 聚焦并全选标题栏（新建 piece 后原地改名）。 */
  focusTitle?: () => void;
  /** 回车提交标题后，焦点跳到正文编辑器首行。 */
  focusBody: () => void;
  /** 当前写作编辑器是否处于大纲模式。 */
  isOutlineMode?: () => boolean;
  /** 切换写作编辑器正文/大纲模式。 */
  setOutlineMode?: (next: boolean) => void;
}

export function outlineToggleState(outlineOn: boolean): { icon: string; pressed: boolean } {
  return {
    icon: outlineOn ? "ph-list-tree" : "ph-text-align-left",
    pressed: outlineOn,
  };
}

/**
 * 写作栏的文档头分两处挂载：
 *  - 顶栏（topbarMount，固定不随正文滚动）：breadcrumb 切换行 + 版本入口 +
 *    .piece-mode-slot（给未来的 大纲/正文 模式切换预留的空位）。
 *  - 标题（titleMount，随正文滚动）：大标题（= 文件名，可编辑）。
 * 单栏 / 双栏共用同一份 DOM，左缘与正文对齐，故两种模式表现完全一致。
 * 文档模式下整行 #piece-topbar-root 由 CSS 隐藏：独立文档无项目内切换、无版本历史，
 * 删除走左上角切换菜单的「文档」区逐行垃圾桶（与项目模式删成品同构）。
 */
export function createPieceHeader(args: {
  topbarMount: HTMLElement;
  titleMount: HTMLElement;
  host: PieceHeaderHost;
}) {
  const { topbarMount, titleMount, host } = args;
  let menuEl: HTMLElement | null = null;
  let renaming = false;

  const crumb = document.createElement("button");
  crumb.className = "piece-breadcrumb";
  crumb.title = "切换成品";
  const crumbLabel = document.createElement("span");
  crumbLabel.className = "piece-breadcrumb-label";
  crumbLabel.textContent = "-";
  crumb.append(
    createIcon({ phosphor: "ph ph-file-text", size: 12 }),
    crumbLabel,
    createIcon({ phosphor: "ph ph-caret-down", size: 12 }),
  );
  crumb.onclick = (e) => {
    e.stopPropagation();
    void openMenu();
  };

  // 版本入口：切换行最右端的低调时钟图标，点击向下展开版本菜单。
  const versionBtn = document.createElement("button");
  versionBtn.className = "piece-version-btn";
  versionBtn.title = "版本";
  versionBtn.append(createIcon({ phosphor: "ph ph-clock-counter-clockwise", size: 14 }));
  versionBtn.onclick = (e) => {
    e.stopPropagation();
    void openVersionMenu();
  };

  // breadcrumb 与版本入口共处一行：左切换、右版本。
  const crumbRow = document.createElement("div");
  crumbRow.className = "piece-crumb-row";
  crumbRow.appendChild(crumb);
  crumbRow.appendChild(versionBtn);

  // 模式切换预留位：大纲/正文 toggle 放在这里，保持既有顶栏布局测试约束。
  const modeSlot = document.createElement("div");
  modeSlot.className = "piece-mode-slot";
  let modeToggle: HTMLButtonElement | null = null;
  if (host.setOutlineMode) {
    modeToggle = document.createElement("button");
    modeToggle.type = "button";
    modeToggle.className = "piece-mode-btn piece-mode-toggle";
    modeToggle.title = "切换正文 / 大纲";
    modeToggle.setAttribute("aria-label", "切换正文 / 大纲");
    modeToggle.onclick = (e) => {
      e.preventDefault();
      host.setOutlineMode?.(!(host.isOutlineMode?.() ?? false));
    };
    modeSlot.appendChild(modeToggle);
  }

  // 标题即可编辑文本区：长标题自然软包折行，回车提交重命名并跳到正文。
  // value 永远单行（回车不写入换行符），折行只是视觉呈现。
  const title = document.createElement("textarea");
  title.className = "piece-title-input";
  title.rows = 1;
  title.spellcheck = false;
  title.setAttribute("aria-label", "成品标题（即文件名）");
  // textarea 默认能输入换行；标题=文件名不允许换行符，统一拦掉。
  title.setAttribute("wrap", "soft");

  topbarMount.appendChild(crumbRow);
  topbarMount.appendChild(modeSlot);
  titleMount.appendChild(title);
  if (modeToggle) syncOutlineMode(host.isOutlineMode?.() ?? false);

  function fit() {
    // 粘贴 / IME 可能带入换行符；标题=文件名永远是单行，落到 value 前先剔掉。
    if (title.value.includes("\n")) {
      const pos = Math.min(title.selectionStart ?? title.value.length, title.value.length);
      title.value = title.value.replace(/\n/g, "");
      title.selectionStart = title.selectionEnd = Math.min(pos, title.value.length);
    }
    // 软包折行后按内容高度撑高，不出现内部滚动条。
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  }

  function setLabel(name: string) {
    title.value = name;
    crumb.querySelector<HTMLElement>(".piece-breadcrumb-label")!.textContent = name;
    title.classList.remove("rename-error");
    fit();
  }

  function syncOutlineMode(outlineOn: boolean) {
    if (!modeToggle) return;
    const state = outlineToggleState(outlineOn);
    modeToggle.innerHTML = `<i class="ph ${state.icon}"></i>`;
    modeToggle.classList.toggle("active", state.pressed);
    modeToggle.setAttribute("aria-pressed", String(state.pressed));
  }

  /** 聚焦标题并全选，供新建 piece / 文档后原地改名。等一帧让布局就位。 */
  function focusTitle() {
    requestAnimationFrame(() => {
      title.focus();
      title.select();
    });
  }

  title.addEventListener("input", fit);
  // 窗口变窄 → 软包行数变多，按内容重撑高，避免高度停留在旧值被裁掉。
  const ro = new ResizeObserver(() => fit());
  ro.observe(title);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // 回车=提交重命名并跳到正文；Shift+Enter 同样不换行（标题永远单行 value）。
      e.preventDefault();
      title.blur();
      host.focusBody();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const cur = host.current();
      if (cur) setLabel(cur.name);
      title.blur();
    }
  });
  title.addEventListener("blur", () => void commitRename());

  async function commitRename() {
    const cur = host.current();
    if (!cur || renaming) return;
    const stem = sanitizePieceStem(title.value);
    // 空 / 非法 / 未改名 → 还原，不落盘。
    if (!stem || stem === cur.name) {
      setLabel(cur.name);
      return;
    }
    renaming = true;
    try {
      const newPath = await renameNote(host.dir(), cur.name, stem);
      host.open({ name: stem, path: newPath });
    } catch {
      title.classList.add("rename-error");
      setTimeout(() => setLabel(cur.name), 1200);
    } finally {
      renaming = false;
    }
  }

  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }

  let versionMenuEl: HTMLElement | null = null;
  function closeVersionMenu() {
    versionMenuEl?.remove();
    versionMenuEl = null;
  }

  async function openVersionMenu() {
    if (versionMenuEl) {
      closeVersionMenu();
      return;
    }
    if (!host.current()) return;
    const entries = await host.loadVersions();
    const menu = document.createElement("div");
    versionMenuEl = menu;
    menu.className = "version-menu";

    // 顶部一行：手动记录当前版本（与成品切换菜单顶部的「新建」行同构）。
    const snap = document.createElement("button");
    snap.className = "version-item version-snap-row";
    snap.append(createIcon({ phosphor: "ph ph-camera", size: 12 }), document.createTextNode("记录当前版本"));
    snap.onclick = async (e) => {
      e.stopPropagation();
      closeVersionMenu();
      await host.snapshot();
    };
    menu.appendChild(snap);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "version-empty";
      empty.textContent = "暂无版本";
      menu.appendChild(empty);
    }
    for (const entry of [...entries].reverse()) {
      const item = document.createElement("button");
      item.className = "version-item";
      item.textContent = formatVersionLabel(entry);
      item.onclick = () => {
        closeVersionMenu();
        void (async () => {
          if (!(await confirmDialog("恢复到该版本？当前内容会被覆盖（已自动存为新版本）。"))) return;
          host.restore(entry.v);
        })();
      };
      menu.appendChild(item);
    }

    const rect = versionBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", closeVersionMenu, { once: true }), 0);
  }

  async function openMenu() {
    if (menuEl) {
      closeMenu();
      return;
    }
    const dir = host.dir();
    if (!dir) return;
    const pieces = await listPieces(dir);
    menuEl = document.createElement("div");
    menuEl.className = "switch-menu";
    const rect = crumb.getBoundingClientRect();
    menuEl.style.left = `${rect.left}px`;
    menuEl.style.top = `${rect.bottom + 4}px`;

    // 顶部：新建图标行。
    const newItem = document.createElement("button");
    newItem.className = "switch-item piece-new-row";
    newItem.append(createIcon({ phosphor: "ph ph-plus", size: 13 }), document.createTextNode("新建"));
    newItem.onclick = async (e) => {
      e.stopPropagation();
      const entry = await createNote(host.dir(), "未命名作品");
      closeMenu();
      await host.open(entry);
      host.focusTitle?.();
    };
    menuEl.appendChild(newItem);

    const cur = host.current();
    for (const piece of pieces) {
      const row = document.createElement("div");
      row.className = "switch-row";
      if (cur && piece.path === cur.path) row.classList.add("active");

      const label = document.createElement("button");
      label.className = "switch-row-label";
      const labelName = document.createElement("span");
      labelName.className = "switch-row-name";
      labelName.textContent = piece.name;
      label.append(createIcon({ phosphor: "ph ph-file-text", size: 13 }), labelName);
      label.onclick = (e) => {
        e.stopPropagation();
        closeMenu();
        host.open(piece);
      };

      const del = document.createElement("button");
      del.className = "switch-row-action switch-row-delete";
      del.title = "删除";
      del.append(createIcon({ phosphor: "ph ph-trash", size: 13 }));
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog(`删除「${piece.name}」？它会被移到废纸篓。`))) return;
        try {
          await deleteNote(host.dir(), piece.name);
        } catch (err) {
          console.error("delete piece failed", err);
          return;
        }
        closeMenu();
        // 删的是当前成品 → 切到下一个；没有则进入 NO_PIECE 空态（不再兜底建空文件）。
        if (cur && piece.path === cur.path) {
          const remaining = await listPieces(host.dir());
          if (remaining[0]) {
            host.open(remaining[0]);
          } else {
            host.onEmptied?.();
          }
        }
      };

      const actions = document.createElement("div");
      actions.className = "switch-row-actions";
      actions.appendChild(del);
      row.appendChild(label);
      row.appendChild(actions);
      menuEl.appendChild(row);
    }

    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }

  return { setLabel, focusTitle, closeMenu, closeVersionMenu, setOutlineMode: syncOutlineMode };
}
