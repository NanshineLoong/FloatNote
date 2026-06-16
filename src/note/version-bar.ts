import { formatVersionLabel, type VersionEntry } from "./versions";

export interface VersionBarCallbacks {
  onSnapshot: () => void;
  onRestore: (v: number) => void;
  loadVersions: () => Promise<VersionEntry[]>;
}

export function renderVersionBar(root: HTMLElement, callbacks: VersionBarCallbacks) {
  root.innerHTML = `
    <div class="version-bar">
      <button class="version-btn" id="version-btn"><i class="ph ph-clock-counter-clockwise"></i><span>版本</span></button>
      <button class="version-snap" id="version-snap" title="打快照"><i class="ph ph-camera"></i></button>
    </div>
  `;

  let menu: HTMLElement | null = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };

  const btn = root.querySelector<HTMLElement>("#version-btn")!;
  btn.onclick = async () => {
    if (menu) {
      closeMenu();
      return;
    }
    const entries = await callbacks.loadVersions();
    menu = document.createElement("div");
    menu.className = "version-menu";
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
        closeMenu();
        callbacks.onRestore(entry.v);
      };
      menu.appendChild(item);
    }
    const rect = btn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  };

  root.querySelector<HTMLElement>("#version-snap")!.onclick = callbacks.onSnapshot;
}
