import { sanitizePieceStem } from "./piece-name";
import { createNote, listPieces, renameNote, type NoteEntry } from "./notes-state";

export interface PieceHeaderHost {
  /** 当前项目文件夹路径。 */
  dir: () => string;
  /** 当前成品（用于高亮 / 重命名旧名）。 */
  current: () => NoteEntry | null;
  /** 切到某成品（switch / 新建 / 重命名后）。 */
  open: (entry: NoteEntry) => void;
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

  // 标题即可编辑文本框：键入像写 Notion 标题，失焦/回车提交重命名。
  const title = document.createElement("input");
  title.className = "piece-title-input";
  title.spellcheck = false;
  title.setAttribute("aria-label", "成品标题（即文件名）");

  mount.appendChild(crumb);
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
      const item = document.createElement("button");
      item.className = "switch-item";
      item.textContent = piece.name;
      if (cur && piece.path === cur.path) item.classList.add("active");
      item.onclick = () => {
        closeMenu();
        host.open(piece);
      };
      menuEl.appendChild(item);
    }

    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }

  return { setLabel, closeMenu };
}
