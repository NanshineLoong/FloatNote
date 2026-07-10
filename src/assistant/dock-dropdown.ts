/**
 * Shared docked-dropdown lifecycle used by `mention-picker.ts` 与 `skill-picker.ts`.
 *
 * 两者共享的下拉生命周期：懒建 `hidden` div → 挂到指定 parent → click 事件委托
 * （按 selector 命中元素取 data-* 属性值）→ 内部 pointerdown stopPropagation →
 * `replaceChildren` + unhide 开启 → `hidden=true` 隐藏 → 外点关闭（input 视为内部）
 * → destroy 移除 document 监听与下拉 DOM。
 *
 * 不包含：触发逻辑（`@query` / `/query` 检测）、列表渲染、apply 函数、互斥关闭、
 * 浮层菜单（skill 右键菜单走 `floating.ts`）。只抽真正重复的下拉生命周期。
 */

export interface DockDropdownOptions {
  /** dropdown 元素的 class（如 "assistant-mention-dropdown"）。 */
  className: string;
  /** 挂载父节点；为 null 时下拉不挂载（镜像原 `parentElement?.appendChild` 语义）。 */
  parent: HTMLElement | null;
  /** 视为「内部」的元素（外点关闭时不算外）。通常是输入框。 */
  inside: HTMLElement;
  /** 项的选中选择器，如 "[data-mention-name]"。 */
  selector: string;
  /** 命中元素上取的属性名，如 "data-mention-name"；值传给 `onSelect`。 */
  attr: string;
  /** 选中某项时调用（参数为属性值）。 */
  onSelect: (value: string) => void;
  /** 外点关闭时调用（调用方负责 hide + 自身状态清理）。 */
  onOutside: () => void;
}

export interface DockDropdownHandle {
  /** 用给定内容开启下拉（懒建元素 + replaceChildren + unhide）。 */
  show: (content: HTMLElement) => void;
  /** 隐藏下拉（设 `hidden=true`）。 */
  hide: () => void;
  /** 下拉是否存在且未 `hidden`。 */
  isOpen: () => boolean;
  /** 移除 document pointerdown 监听与下拉 DOM。 */
  destroy: () => void;
}

export function createDockDropdown(opts: DockDropdownOptions): DockDropdownHandle {
  const { className, parent, inside, selector, attr, onSelect, onOutside } = opts;
  let dropdown: HTMLElement | null = null;

  /** 首次调用时懒建元素并挂载；后续返回既有元素。 */
  function ensureEl(): HTMLElement {
    if (!dropdown) {
      const el = document.createElement("div");
      el.className = className;
      el.hidden = true;
      el.addEventListener("click", (e) => {
        const target = e.target instanceof Element ? e.target.closest(selector) : null;
        if (!target) return;
        const value = target.getAttribute(attr);
        if (value == null) return;
        onSelect(value);
      });
      // 下拉内部 pointerdown 不冒泡，避免触发外点关闭与 assistant 的 onDocumentPointerDown。
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      parent?.appendChild(el);
      dropdown = el;
    }
    return dropdown;
  }

  function show(content: HTMLElement): void {
    const el = ensureEl();
    el.replaceChildren(content);
    el.hidden = false;
  }

  function hide(): void {
    if (dropdown) dropdown.hidden = true;
  }

  function isOpen(): boolean {
    return dropdown !== null && !dropdown.hidden;
  }

  function onDocPointerDown(e: PointerEvent) {
    if (!dropdown || dropdown.hidden) return;
    const target = e.target;
    if (target instanceof Node && (dropdown.contains(target) || inside.contains(target))) {
      return;
    }
    onOutside();
  }
  document.addEventListener("pointerdown", onDocPointerDown);

  function destroy(): void {
    document.removeEventListener("pointerdown", onDocPointerDown);
    dropdown?.remove();
    dropdown = null;
  }

  return { show, hide, isOpen, destroy };
}
