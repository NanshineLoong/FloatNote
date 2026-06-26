import { sanitizePieceStem } from "./piece-name";
import { createNote, listPieces, renameNote, type NoteEntry } from "./notes-state";

export interface PieceSwitcherHost {
  /** 当前项目文件夹路径。 */
  dir: () => string;
  /** 当前成品（用于高亮 / 重命名旧名）。 */
  current: () => NoteEntry | null;
  /** 切到某成品（switch / 新建后）。 */
  open: (entry: NoteEntry) => void;
}

/** 居中成品名「药丸」+ 下拉（切换 / 新建 / 就地重命名）。返回 setLabel 钩子刷新标签。 */
export function createPieceSwitcher(mount: HTMLElement, host: PieceSwitcherHost) {
  let menuEl: HTMLElement | null = null;

  const pill = document.createElement("button");
  pill.className = "note-name piece-pill";
  pill.title = "切换 / 重命名成品";
  pill.innerHTML = `<span class="piece-label">-</span>`;
  pill.onclick = () => void openMenu();
  mount.appendChild(pill);

  function setLabel(name: string) {
    pill.querySelector<HTMLElement>(".piece-label")!.textContent = name;
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
    const rect = pill.getBoundingClientRect();
    menuEl.style.left = `${rect.left}px`;
    menuEl.style.top = `${rect.bottom + 2}px`;

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

    const renameItem = document.createElement("button");
    renameItem.className = "switch-item";
    renameItem.innerHTML = `<i class="ph ph-pencil-simple"></i> 重命名当前`;
    renameItem.onclick = (e) => {
      e.stopPropagation();
      void startRename();
    };
    menuEl.appendChild(renameItem);

    const newItem = document.createElement("button");
    newItem.className = "switch-item switch-new";
    newItem.innerHTML = `<i class="ph ph-plus"></i> 新建成品`;
    newItem.onclick = async (e) => {
      e.stopPropagation();
      const entry = await createNote(host.dir());
      closeMenu();
      host.open(entry);
    };
    menuEl.appendChild(newItem);

    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }

  async function startRename() {
    const cur = host.current();
    if (!cur) return;
    const input = document.createElement("input");
    input.className = "note-name-input";
    input.value = cur.name;
    pill.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("click", (e) => e.stopPropagation());

    let submitting = false;
    const restore = () => {
      input.replaceWith(pill);
    };
    async function confirm() {
      if (submitting) return;
      const stem = sanitizePieceStem(input.value);
      if (!stem || stem === cur!.name) {
        restore();
        closeMenu();
        return;
      }
      submitting = true;
      try {
        const newPath = await renameNote(host.dir(), cur!.name, stem);
        closeMenu();
        host.open({ name: stem, path: newPath });
      } catch {
        input.classList.add("rename-error");
        submitting = false;
      }
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        restore();
        closeMenu();
      }
    });
  }

  return { setLabel, closeMenu };
}
