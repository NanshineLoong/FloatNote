export interface TopbarCallbacks {
  onPickDir: () => void;
  onToggleMenu: (anchor: HTMLElement) => void;
  onNew: () => void;
}

export function renderTopbar(root: HTMLElement, callbacks: TopbarCallbacks) {
  root.innerHTML = `
    <div class="topbar">
      <button class="dir-name" id="dir-name" title=""><span id="dir-label">-</span></button>
      <span class="sep">/</span>
      <button class="note-name" id="note-name">
        <span id="note-label">-</span><i class="ph ph-caret-down"></i>
      </button>
      <span class="spacer"></span>
      <button class="new-btn" id="new-btn" title="新建笔记"><i class="ph ph-plus"></i></button>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;
  const noteButton = root.querySelector<HTMLElement>("#note-name")!;
  noteButton.onclick = () => callbacks.onToggleMenu(noteButton);
  root.querySelector<HTMLElement>("#new-btn")!.onclick = callbacks.onNew;
}

export function setDirLabel(name: string, fullPath: string) {
  const label = document.querySelector<HTMLElement>("#dir-label")!;
  label.textContent = name;
  document.querySelector<HTMLElement>("#dir-name")!.title = fullPath;
}

export function setNoteLabel(name: string) {
  document.querySelector<HTMLElement>("#note-label")!.textContent = name;
}

