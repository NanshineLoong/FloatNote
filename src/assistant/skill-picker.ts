import { closeFloating, floatMenuAnchored } from "../shared/ui/floating-menu.js";
import { createDockDropdown } from "./dock-dropdown.js";

/**
 * Skill picker：两种显式入口（spec §4.3）。
 *
 * - 右键 Socrates 小人 → 锚定到小人的 skill 菜单（`floatMenuAnchored`：收起态开在
 *   小人左上方、展开态开在右上方，自带 flip+clamp）。选中后立即展开输入框。
 * - 输入框行首输入 `/` → 在 `.assistant-dock` 上弹出过滤下拉。下拉生命周期复用
 *   `dock-dropdown.ts`（`[hidden]` 切换 + `replaceChildren`，挂在 input-wrap 的兄弟节点
 *   以避开其 overflow:hidden）。
 *
 * 选中后把输入框置为 `/skill:<name> ` 前缀，由 Pi 的 `session.prompt` 原生展开。
 * 前端不做语义解析。复用 `closeFloating` 的单浮层不变式与外点关闭。
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
  /** 收起态选中技能后立即展开输入框（assistant 注入 setInputOpen(true)）；展开态 no-op。 */
  openInput: () => void;
  /** 打开 `/` 下拉时关闭互斥的 mention 下拉（assistant 注入）。 */
  closeMention?: () => void;
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
  const { bot, input, inputWrap, listSkills, openInput, closeMention } = opts;
  let cache: SkillSummary[] | null = null;
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

  // ── 右键小人 → 锚定到小人的技能菜单 ───────────────────────────────────
  // 收起态（inputWrap 无 .open，小人在窗口右下角）开在小人左上方（up-left）；
  // 展开态开在小人右上方（up-right）。选中后立即展开输入框。floatMenuAnchored 自带 flip+clamp。
  function openMenuAt(skills: SkillSummary[]): void {
    const menu = renderSkillList(skills, "");
    menu.classList.add("switch-menu", "assistant-skill-menu");
    menu.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest("[data-skill-name]") : null;
      if (!target) return;
      const name = target.getAttribute("data-skill-name")!;
      applySkill(input, name);
      closeFloating();
      close();
      openInput();
    });
    const expanded = inputWrap.classList.contains("open");
    floatMenuAnchored(menu, bot.getBoundingClientRect(), expanded ? "up-right" : "up-left");
    open = true;
  }

  async function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const skills = await ensureSkills();
    if (skills.length === 0) return; // 空态不弹
    openMenuAt(skills);
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

  function close(): void {
    closeFloating();
    menu.hide();
    open = false;
  }

  // 复用共享 dock-dropdown：click 委托 + pointerdown stopPropagation + 外点关闭 + 生命周期。
  // 挂到 .assistant-dock（input-wrap 的父节点）而非 input-wrap 内部：input-wrap 有
  // overflow:hidden（用于输入框滑入动画），下拉用 bottom:calc(100%+6px) 定位在其外侧
  // 上方，挂内部会被裁掉看不见。历史浮层同理挂在 dock 上（assistant.ts 的 history popover）。
  const menu = createDockDropdown({
    className: "assistant-skill-dropdown",
    parent: inputWrap.parentElement,
    inside: input,
    selector: "[data-skill-name]",
    attr: "data-skill-name",
    onSelect: (name) => {
      applySkill(input, name);
      close();
    },
    onOutside: close,
  });

  function openDropdown(skills: SkillSummary[], query: string): void {
    menu.show(renderSkillList(skills, query));
    open = true;
  }

  async function onInput() {
    const query = currentSlashQuery();
    if (query === null) {
      menu.hide();
      if (!isMenuFloating()) open = false;
      return;
    }
    const skills = await ensureSkills();
    if (skills.length === 0) {
      menu.hide();
      return;
    }
    // 输入期间 `/query` 可能已变（异步拉取），重新校验。
    if (currentSlashQuery() === null) {
      menu.hide();
      return;
    }
    closeMention?.(); // 与 mention 下拉互斥
    openDropdown(skills, query);
  }

  input.addEventListener("input", onInput);

  function isMenuFloating(): boolean {
    return document.querySelector(".assistant-skill-menu.tag-floating") !== null;
  }

  function isOpen(): boolean {
    return open || isMenuFloating() || menu.isOpen();
  }

  function destroy(): void {
    close();
    bot.removeEventListener("contextmenu", onContextMenu);
    input.removeEventListener("input", onInput);
    menu.destroy();
  }

  return { destroy, isOpen, close };
}
