import type { EditorView } from "@codemirror/view";
import { freeColors, type TagDef } from "@floatnote/note-logic";
import { showToast } from "../../shared/toast";
import { createMenu } from "../../shared/ui/menu";
import { inboxMetadata, replaceInboxMetadata } from "../annotations/state";
import { PALETTE } from "./palette";
import { activeTagFilter, setTagFilterEffect } from "./filter";

export interface TagBarHandle {
  el: HTMLElement;
  refresh: () => void;
  setActive: (tagId: string | null) => void;
}

export function mountTagBar(
  view: EditorView,
  onFilterChange: (tagId: string | null) => void = () => {},
): TagBarHandle {
  const el = document.createElement("div");
  el.className = "tag-bar";
  const allButton = document.createElement("button");
  allButton.className = "tag-filter-all";
  allButton.type = "button";
  allButton.innerHTML = `<i class="ph ph-squares-four"></i><span>全部</span>`;
  allButton.title = "显示全部";
  const discRow = document.createElement("div");
  discRow.className = "tag-disc-row";
  const readonlyHint = document.createElement("div");
  readonlyHint.className = "tag-readonly-hint";
  readonlyHint.innerHTML = `<i class="ph ph-lock"></i><span>只读视图</span>`;
  readonlyHint.hidden = true;
  el.append(allButton, discRow, readonlyHint);

  let lastSignature = "";
  const refresh = (): void => {
    const metadata = inboxMetadata(view.state);
    const active = activeTagFilter(view.state);
    const signature = JSON.stringify([metadata.tags, active]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    allButton.classList.toggle("active", active === null);
    readonlyHint.hidden = active === null;
    discRow.innerHTML = "";
    for (const def of metadata.tags) discRow.appendChild(buildDisc(view, def, def.id === active, setActive));
  };
  const setActive = (tagId: string | null): void => {
    setTagFilterEffect(view, tagId);
    onFilterChange(tagId);
    refresh();
  };
  allButton.onclick = () => setActive(null);
  refresh();
  return { el, refresh, setActive };
}

function buildDisc(
  view: EditorView,
  def: TagDef,
  active: boolean,
  setActive: (tagId: string | null) => void,
): HTMLElement {
  const disc = document.createElement("button");
  disc.type = "button";
  disc.className = "tag-disc tag-filter-disc";
  if (active) disc.classList.add("active");
  disc.style.setProperty("--c", def.color);
  disc.ariaLabel = def.name;
  disc.innerHTML = `<span class="tag-filter-dot" aria-hidden="true"></span>`;
  const name = document.createElement("span");
  name.className = "tag-filter-name";
  name.textContent = def.name;
  disc.appendChild(name);
  disc.onclick = (event) => {
    event.stopPropagation();
    setActive(nextTagFilter(activeTagFilter(view.state), def.id));
  };
  disc.oncontextmenu = (event) => {
    event.preventDefault();
    openContextMenu(view, def, event.clientX, event.clientY, setActive);
  };
  return disc;
}

export function nextTagFilter(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

function openContextMenu(
  view: EditorView,
  def: TagDef,
  x: number,
  y: number,
  setActive: (tagId: string | null) => void,
): void {
  const menu = createMenu();
  menu.el.classList.add("tag-context-menu", "tag-edit-popover");
  const close = () => menu.hide();
  const input = document.createElement("input");
  input.className = "fn-control tag-add-input";
  input.type = "text";
  input.value = def.name;
  input.maxLength = 24;
  const row = document.createElement("div");
  row.className = "swatch-row";
  const metadata = inboxMetadata(view.state);
  const allowed = new Set(freeColors(new Set(metadata.tags
    .filter((tag) => tag.id !== def.id)
    .map((tag) => tag.color.toLowerCase()))));
  for (const swatch of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.setProperty("--c", swatch.color);
    button.disabled = !allowed.has(swatch.color);
    if (swatch.color === def.color) button.classList.add("selected");
    button.onclick = () => {
      const current = inboxMetadata(view.state);
      view.dispatch({ effects: replaceInboxMetadata.of({
        ...current,
        tags: current.tags.map((tag) => tag.id === def.id ? { ...tag, color: swatch.color } : tag),
      }) });
      close();
    };
    row.appendChild(button);
  }
  const commitName = (): void => {
    const value = input.value.trim();
    if (!value || value === def.name) return;
    const current = inboxMetadata(view.state);
    view.dispatch({ effects: replaceInboxMetadata.of({
      ...current,
      tags: current.tags.map((tag) => tag.id === def.id ? { ...tag, name: value } : tag),
    }) });
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitName(); close(); }
    if (event.key === "Escape") close();
  };
  input.onblur = commitName;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "fn-menu__item fn-menu__item--danger tag-context-delete";
  remove.innerHTML = `<i class="ph ph-trash"></i> 删除`;
  remove.onclick = () => {
    const current = inboxMetadata(view.state);
    const removedCount = current.annotations.filter((annotation) => annotation.tagId === def.id).length;
    if (activeTagFilter(view.state) === def.id) setActive(null);
    view.dispatch({ effects: replaceInboxMetadata.of({
      ...current,
      tags: current.tags.filter((tag) => tag.id !== def.id),
      annotations: current.annotations.filter((annotation) => annotation.tagId !== def.id),
    }) });
    showToast(`已删除标签「${def.name}」及 ${removedCount} 个标注，⌘Z 撤销`);
    close();
  };
  menu.showAt(x, y, [input, row, remove]);
  input.focus();
  input.select();
}
