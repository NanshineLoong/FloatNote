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
  /** 删除当前装载的文件（文档模式下由标题栏垃圾桶触发）。 */
  onDelete: () => void;
}

/**
 * 写作栏的文档头：上方小号 breadcrumb 切换行，下方大标题（= 文件名，可编辑）。
 * 单栏 / 双栏共用同一份 DOM，左缘与正文对齐，故两种模式表现完全一致。
 */
export function createPieceHeader(mount: HTMLElement, host: PieceHeaderHost) {
  let menuEl: HTMLElement | null = null;
  let renaming = false;

  const crumb = document.createElement("button");
  crumb.className = "piece-breadcrumb";
  crumb.title = "切换成品";
  crumb.innerHTML = `
    <i class="ph ph-file-text"></i>
    <span class="piece-breadcrumb-label">-</span>
    <i class="ph ph-caret-down"></i>
  `;
  crumb.onclick = (e) => {
    e.stopPropagation();
    void openMenu();
  };

  // 版本入口：切换行最右端的低调时钟图标，点击向下展开版本菜单。
  const versionBtn = document.createElement("button");
  versionBtn.className = "piece-version-btn";
  versionBtn.title = "版本";
  versionBtn.innerHTML = `<i class="ph ph-clock-counter-clockwise"></i>`;
  versionBtn.onclick = (e) => {
    e.stopPropagation();
    void openVersionMenu();
  };

  // 文档模式下的删除按钮（项目模式下隐藏，由 .doc-mode 控制）。
  const trashBtn = document.createElement("button");
  trashBtn.className = "piece-trash-btn";
  trashBtn.title = "删除文档";
  trashBtn.innerHTML = `<i class="ph ph-trash"></i>`;
  trashBtn.onclick = (e) => {
    e.stopPropagation();
    host.onDelete();
  };

  // breadcrumb 与版本入口共处一行：左切换、右版本 / 删除。
  const crumbRow = document.createElement("div");
  crumbRow.className = "piece-crumb-row";
  crumbRow.appendChild(crumb);
  crumbRow.appendChild(versionBtn);
  crumbRow.appendChild(trashBtn);

  // 标题即可编辑文本框：键入像写 Notion 标题，失焦/回车提交重命名。
  const title = document.createElement("input");
  title.className = "piece-title-input";
  title.spellcheck = false;
  title.setAttribute("aria-label", "成品标题（即文件名）");

  mount.appendChild(crumbRow);
  mount.appendChild(title);

  function fit() {
    title.size = Math.max(title.value.length + 1, 3);
  }

  function setLabel(name: string) {
    title.value = name;
    crumb.querySelector<HTMLElement>(".piece-breadcrumb-label")!.textContent = name;
    title.classList.remove("rename-error");
    fit();
  }

  title.addEventListener("input", fit);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
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
    snap.innerHTML = `<i class="ph ph-camera"></i> 记录当前版本`;
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
    newItem.innerHTML = `<i class="ph ph-plus"></i> 新建`;
    newItem.onclick = async (e) => {
      e.stopPropagation();
      const entry = await createNote(host.dir());
      closeMenu();
      host.open(entry);
    };
    menuEl.appendChild(newItem);

    const cur = host.current();
    for (const piece of pieces) {
      const row = document.createElement("div");
      row.className = "switch-row";
      if (cur && piece.path === cur.path) row.classList.add("active");

      const label = document.createElement("button");
      label.className = "switch-row-label";
      label.innerHTML = `<i class="ph ph-file-text"></i><span class="switch-row-name">${piece.name}</span>`;
      label.onclick = (e) => {
        e.stopPropagation();
        closeMenu();
        host.open(piece);
      };

      const del = document.createElement("button");
      del.className = "switch-row-action switch-row-delete";
      del.title = "删除";
      del.innerHTML = `<i class="ph ph-trash"></i>`;
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
        // 删的是当前成品 → 选下一个，没有就新建空成品。
        if (cur && piece.path === cur.path) {
          const remaining = await listPieces(host.dir());
          const next = remaining[0] ?? (await createNote(host.dir()));
          host.open(next);
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

  return { setLabel, closeMenu, closeVersionMenu };
}
