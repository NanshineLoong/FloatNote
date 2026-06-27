import socratesIconSvg from "../assets/socrates_head_icon.svg?raw";

export interface TopbarCallbacks {
  /** 项目名按钮：开/关项目空间下拉（含切换最近项目、新建项目）。 */
  onToggleProjects: (anchor: HTMLElement) => void;
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
        <button class="project-name" id="project-name" title="切换项目空间">
          <i class="ph ph-folder"></i><span id="project-label">-</span><i class="ph ph-caret-down"></i>
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
      </div>
    </div>
  `;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#split-toggle")!.onclick = callbacks.onToggleSplit;
  root.querySelector<HTMLElement>("#tasks-toggle")!.onclick = callbacks.onToggleTasks;

  root.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => callbacks.onSelectSurface(btn.dataset.surface as "inbox" | "piece");
  });
}

export function setProjectLabel(name: string) {
  document.querySelector<HTMLElement>("#project-label")!.textContent = name;
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
