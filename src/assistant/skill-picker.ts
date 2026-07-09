import { closeFloating, floatMenu } from "../note/tags/floating.js";

/**
 * Skill picker：两种显式入口（spec §4.3）。
 *
 * - 右键 Socrates 小人 → 在光标处弹 skill 菜单（复用 `floatMenu`，镜像
 *   `src/note/tags/bar.ts` 的 `oncontextmenu`）。
 * - 输入框行首输入 `/` → 在 `.assistant-input-wrap` 内弹出过滤下拉（镜像
 *   assistant.ts 的 history popover：`[hidden]` 切换 + `replaceChildren`）。
 *
 * 选中后把输入框置为 `/skill:<name> ` 前缀，由 Pi 的 `session.prompt` 原生展开。
 * 前端不做语义解析。复用 `floatMenu` 的单浮层不变式与外点关闭。
 */

export interface SkillSummary {
  name: string;
  description: string;
}

export interface SkillPickerOptions {
  bot: HTMLElement;
  input: HTMLTextAreaElement;
  inputWrap: HTMLElement;
  listSkills: () => Promise<SkillSummary[]>;
}

export interface SkillPickerHandle {
  destroy: () => void;
  isOpen: () => boolean;
  close: () => void;
}

/**
 * 纯函数：构建 skill 列表 DOM（供 jsdom 测试）。按 name/description 子串过滤。
 * 每项是 `<button data-skill-name="...">`，含 name + description 两个 span。
 * 不挂监听——由调用方做事件委托。
 */
export function renderSkillList(skills: SkillSummary[], query: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "assistant-skill-list";
  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : skills;
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "assistant-skill-empty";
    empty.textContent = "没有匹配的 skill";
    container.appendChild(empty);
    return container;
  }
  for (const s of filtered) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "assistant-skill-item";
    item.dataset.skillName = s.name;
    const name = document.createElement("span");
    name.className = "assistant-skill-name";
    name.textContent = s.name;
    const desc = document.createElement("span");
    desc.className = "assistant-skill-desc";
    desc.textContent = s.description;
    item.append(name, desc);
    container.appendChild(item);
  }
  return container;
}

/** 把选中 skill 拼成 `/skill:<name> ` 前缀写入输入框，光标置尾并聚焦。 */
function applySkill(input: HTMLTextAreaElement, name: string): void {
  input.value = `/skill:${name} `;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  // 触发 autosize（assistant.ts 监听 input 事件）
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function mountSkillPicker(opts: SkillPickerOptions): SkillPickerHandle {
  const { bot, input, inputWrap, listSkills } = opts;
  let cache: SkillSummary[] | null = null;
  let dropdown: HTMLElement | null = null;
  let open = false;

  async function ensureSkills(): Promise<SkillSummary[]> {
    if (cache) return cache;
    try {
      cache = await listSkills();
    } catch {
      cache = [];
    }
    return cache;
  }

  // ── 右键小人 → floatMenu 列表 ─────────────────────────────────────────
  function openMenuAt(x: number, y: number, skills: SkillSummary[]): void {
    const menu = renderSkillList(skills, "");
    menu.classList.add("switch-menu", "assistant-skill-menu");
    menu.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest("[data-skill-name]") : null;
      if (!target) return;
      const name = target.getAttribute("data-skill-name")!;
      applySkill(input, name);
      closeFloating();
      close();
    });
    floatMenu(menu, x, y);
    open = true;
  }

  async function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const skills = await ensureSkills();
    if (skills.length === 0) return; // 空态不弹
    openMenuAt(e.clientX, e.clientY, skills);
  }

  bot.addEventListener("contextmenu", onContextMenu);

  // ── 输入框 `/` → 锚定下拉 ─────────────────────────────────────────────
  function currentSlashQuery(): string | null {
    const v = input.value;
    // 仅当以 `/` 开头、且 `/` 后到首个空格之间是过滤词时弹下拉。
    if (!v.startsWith("/")) return null;
    const rest = v.slice(1);
    const firstSpace = rest.indexOf(" ");
    if (firstSpace !== -1) return null; // 已有空格 → 用户在写参数，不再过滤
    return rest;
  }

  function openDropdown(skills: SkillSummary[], query: string): void {
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.className = "assistant-skill-dropdown";
      dropdown.hidden = true;
      dropdown.addEventListener("click", (e) => {
        const target = e.target instanceof Element ? e.target.closest("[data-skill-name]") : null;
        if (!target) return;
        const name = target.getAttribute("data-skill-name")!;
        applySkill(input, name);
        close();
      });
      // 下拉内部 pointerdown 不冒泡，避免触发外点关闭与 assistant 的 onDocumentPointerDown。
      dropdown.addEventListener("pointerdown", (e) => e.stopPropagation());
      inputWrap.appendChild(dropdown);
    }
    dropdown.replaceChildren(renderSkillList(skills, query));
    dropdown.hidden = false;
    open = true;
  }

  function closeDropdown(): void {
    if (dropdown) dropdown.hidden = true;
  }

  async function onInput() {
    const query = currentSlashQuery();
    if (query === null) {
      closeDropdown();
      if (!isMenuFloating()) open = false;
      return;
    }
    const skills = await ensureSkills();
    if (skills.length === 0) {
      closeDropdown();
      return;
    }
    // 输入期间 `/query` 可能已变（异步拉取），重新校验。
    if (currentSlashQuery() === null) {
      closeDropdown();
      return;
    }
    openDropdown(skills, query);
  }

  input.addEventListener("input", onInput);

  // 下拉打开时，点下拉/输入框以外的地方关闭。
  function onDocPointerDown(e: PointerEvent) {
    if (!open || !dropdown || dropdown.hidden) return;
    const target = e.target;
    if (target instanceof Node && (dropdown.contains(target) || input.contains(target))) {
      return;
    }
    close();
  }
  document.addEventListener("pointerdown", onDocPointerDown);

  function isMenuFloating(): boolean {
    return document.querySelector(".assistant-skill-menu.tag-floating") !== null;
  }

  function close(): void {
    closeFloating();
    closeDropdown();
    open = false;
  }

  function isOpen(): boolean {
    return open || isMenuFloating() || (dropdown !== null && !dropdown.hidden);
  }

  function destroy(): void {
    close();
    bot.removeEventListener("contextmenu", onContextMenu);
    input.removeEventListener("input", onInput);
    document.removeEventListener("pointerdown", onDocPointerDown);
    dropdown?.remove();
    dropdown = null;
  }

  return { destroy, isOpen, close };
}
