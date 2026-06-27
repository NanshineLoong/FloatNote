import socratesIconSvg from "../assets/socrates_head_icon.svg?raw";

/** 顶栏居中三段视图：采集（_inbox.md）/ 写作（piece）/ 双栏（并排）。 */
export type ViewSeg = "inbox" | "piece" | "split";

export interface TopbarCallbacks {
  /** 项目名按钮：开/关项目空间下拉（含切换最近项目、新建项目）。 */
  onToggleProjects: (anchor: HTMLElement) => void;
  /** 三段视图切换：采集 / 写作 / 双栏。 */
  onSelectView: (view: ViewSeg) => void;
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
      </div>
      <div class="view-seg" id="view-seg">
        <button class="seg-btn active" data-view="inbox">采集</button>
        <button class="seg-btn" data-view="piece">写作</button>
        <button class="seg-btn" data-view="split" title="双栏（采集 ｜ 写作）">双栏</button>
      </div>
      <div class="topbar-right">
        <button class="icon-btn" id="tasks-toggle" title="清单"><i class="ph ph-list-checks"></i></button>
      </div>
    </div>
  `;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#tasks-toggle")!.onclick = callbacks.onToggleTasks;

  root.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () => callbacks.onSelectView(btn.dataset.view as ViewSeg);
  });
}

export function setProjectLabel(name: string) {
  document.querySelector<HTMLElement>("#project-label")!.textContent = name;
}


/** 高亮当前视图段；窄窗（放不下两栏）时禁用「双栏」段。 */
export function setViewSeg(view: ViewSeg, splitAllowed: boolean) {
  document.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) => {
    const v = btn.dataset.view as ViewSeg;
    btn.classList.toggle("active", v === view);
    if (v === "split") btn.disabled = !splitAllowed;
  });
}

export function setTasksToggle(open: boolean) {
  document.querySelector<HTMLElement>("#tasks-toggle")!.classList.toggle("on", open);
}
