import socratesIconSvg from "../assets/socrates_head_icon.svg?raw";

export interface TopbarCallbacks {
  onPickDir: () => void;
  onToggleMenu: (anchor: HTMLElement) => void;
  onNew: () => void;
  onRename: (newName: string) => Promise<void>;
}

export interface TitlebarCallbacks {
  /** 助手 icon 单击：开/关助手。 */
  onAssistantToggle: () => void;
}

/**
 * 第一行标题栏：左侧空位让系统红绿灯叠加、整行可拖拽，最右端助手 icon。
 * macOS 经 `titleBarStyle:"Overlay"` 与系统标题栏合并为一条。
 */
export function renderTitlebar(root: HTMLElement, callbacks: TitlebarCallbacks) {
  root.innerHTML = `
    <div class="titlebar">
      <div class="titlebar-drag" data-tauri-drag-region></div>
      <button class="assistant-btn" id="assistant-btn" title="开关助手">${socratesIconSvg}</button>
    </div>
  `;
  root.querySelector<HTMLElement>("#assistant-btn")!.onclick = () => callbacks.onAssistantToggle();
}

export function renderTopbar(root: HTMLElement, callbacks: TopbarCallbacks) {
  root.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <button class="dir-name" id="dir-name" title=""><i class="ph ph-folder"></i><span id="dir-label">-</span></button>
        <span class="sep">/</span>
      </div>
      <button class="note-name" id="note-name">
        <span id="note-label">-</span><i class="ph ph-caret-down"></i>
      </button>
      <button class="new-btn" id="new-btn" title="新建笔记"><i class="ph ph-plus"></i></button>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;

  const noteButton = root.querySelector<HTMLElement>("#note-name")!;
  noteButton.onclick = () => callbacks.onToggleMenu(noteButton);

  const noteLabel = root.querySelector<HTMLElement>("#note-label")!;
  noteLabel.onclick = (e) => {
    e.stopPropagation();
    startRename(noteLabel, callbacks.onRename);
  };

  root.querySelector<HTMLElement>("#new-btn")!.onclick = callbacks.onNew;
}

function startRename(noteLabel: HTMLElement, onRename: (newName: string) => Promise<void>) {
  const originalName = noteLabel.textContent!;
  const input = document.createElement("input");
  input.className = "note-name-input";
  input.value = originalName;
  noteLabel.style.display = "none";
  noteLabel.parentElement!.insertBefore(input, noteLabel);
  input.focus();
  input.select();

  let submitting = false;

  async function confirm() {
    if (submitting) return;
    submitting = true;
    input.classList.remove("rename-error");
    const newName = input.value.trim();
    if (!newName || newName === originalName) {
      cancel();
      return;
    }
    try {
      await onRename(newName);
      input.remove();
      noteLabel.style.display = "";
    } catch {
      input.classList.add("rename-error");
      input.select();
      submitting = false;
    }
  }

  function cancel() {
    input.remove();
    noteLabel.style.display = "";
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void confirm(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", () => {
    if (!input.isConnected) return;
    void confirm();
  });
}

export function setDirLabel(name: string, fullPath: string) {
  const label = document.querySelector<HTMLElement>("#dir-label")!;
  label.textContent = name;
  document.querySelector<HTMLElement>("#dir-name")!.title = fullPath;
}

export function setNoteLabel(name: string) {
  document.querySelector<HTMLElement>("#note-label")!.textContent = name;
}
