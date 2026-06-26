import socratesIconSvg from "../assets/socrates_head_icon.svg?raw";

export interface TopbarCallbacks {
  /** 文件夹按钮：挑选工作目录（项目空间的根）。 */
  onPickDir: () => void;
  /** 项目名按钮：开/关项目空间下拉。 */
  onToggleProjects: (anchor: HTMLElement) => void;
  /** "+" 按钮：开下拉并直接进入"新建项目"输入态。 */
  onNewProject: (anchor: HTMLElement) => void;
  /** 顶栏右侧切换：Inbox 卡片视图 ⇄ 原始 Markdown 源码。 */
  onToggleSource: () => void;
  /** 单栏分段切换：显示 Inbox 还是 成品。 */
  onSelectSurface: (surface: "inbox" | "piece") => void;
  /** 分屏开关（仅宽窗生效）。 */
  onToggleSplit: () => void;
  /** 清单面板开关。 */
  onToggleTasks: () => void;
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
        <div class="surface-seg" id="surface-seg">
          <button class="seg-btn active" data-surface="inbox">Inbox</button>
          <button class="seg-btn" data-surface="piece">成品</button>
        </div>
      </div>
      <div class="piece-mount" id="piece-mount"></div>
      <div class="topbar-right">
        <button class="icon-btn" id="tasks-toggle" title="清单"><i class="ph ph-list-checks"></i></button>
        <button class="icon-btn" id="split-toggle" title="分屏（Inbox ｜ 成品）"><i class="ph ph-columns"></i></button>
        <button class="icon-btn" id="src-toggle" title="切换源码 / 卡片"><i class="ph ph-cards"></i></button>
        <button class="icon-btn" id="new-btn" title="新建项目"><i class="ph ph-plus"></i></button>
      </div>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#src-toggle")!.onclick = callbacks.onToggleSource;
  root.querySelector<HTMLElement>("#split-toggle")!.onclick = callbacks.onToggleSplit;
  root.querySelector<HTMLElement>("#tasks-toggle")!.onclick = callbacks.onToggleTasks;

  root.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => callbacks.onSelectSurface(btn.dataset.surface as "inbox" | "piece");
  });

  root.querySelector<HTMLElement>("#new-btn")!.onclick = () => callbacks.onNewProject(projectButton);
}

export function setDirLabel(name: string, fullPath: string) {
  const label = document.querySelector<HTMLElement>("#dir-label")!;
  label.textContent = name;
  document.querySelector<HTMLElement>("#dir-name")!.title = fullPath;
}

export function setProjectLabel(name: string) {
  document.querySelector<HTMLElement>("#project-label")!.textContent = name;
}

export function setSourceToggle(mode: "block" | "source") {
  const button = document.querySelector<HTMLElement>("#src-toggle")!;
  button.innerHTML =
    mode === "block" ? `<i class="ph ph-code"></i>` : `<i class="ph ph-cards"></i>`;
  button.title = mode === "block" ? "查看源码" : "查看卡片";
}

export function setSurfaceSeg(surface: "inbox" | "piece") {
  document.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.surface === surface);
  });
}

export function setSplitToggle(active: boolean) {
  document.querySelector<HTMLElement>("#split-toggle")!.classList.toggle("on", active);
}

export function setTasksToggle(open: boolean) {
  document.querySelector<HTMLElement>("#tasks-toggle")!.classList.toggle("on", open);
}

export function pieceMount(): HTMLElement {
  return document.querySelector<HTMLElement>("#piece-mount")!;
}
