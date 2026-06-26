import socratesIconSvg from "../assets/socrates_head_icon.svg?raw";

export interface TopbarCallbacks {
  /** 文件夹按钮：挑选工作目录（项目空间的根）。 */
  onPickDir: () => void;
  /** 项目名按钮：开/关项目空间下拉。 */
  onToggleProjects: (anchor: HTMLElement) => void;
  /** "+" 按钮：开下拉并直接进入"新建项目"输入态。 */
  onNewProject: (anchor: HTMLElement) => void;
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
        <button class="project-name" id="project-name" title="切换项目空间">
          <span id="project-label">-</span><i class="ph ph-caret-down"></i>
        </button>
      </div>
      <button class="new-btn" id="new-btn" title="新建项目"><i class="ph ph-plus"></i></button>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#new-btn")!.onclick = () =>
    callbacks.onNewProject(projectButton);
}

export function setDirLabel(name: string, fullPath: string) {
  const label = document.querySelector<HTMLElement>("#dir-label")!;
  label.textContent = name;
  document.querySelector<HTMLElement>("#dir-name")!.title = fullPath;
}

export function setProjectLabel(name: string) {
  document.querySelector<HTMLElement>("#project-label")!.textContent = name;
}
