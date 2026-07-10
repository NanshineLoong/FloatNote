/**
 * Block-handle menu for tags. The left gutter handle is the contextual entry:
 * assign/clear an existing tag, create a tag and attach it to the current block,
 * or run block-level actions such as delete.
 */
import { type EditorView } from "@codemirror/view";
import {
  addTagAndSetBlockChanges,
  blockTagId,
  isTagColorTaken,
  parseDefs,
  setBlockTagChange,
  type BlockRange,
} from "@floatnote/note-logic";
import { PALETTE } from "./palette";
import { createMenu } from "../../shared/ui/menu";

export function openBlockTagMenu(
  view: EditorView,
  range: BlockRange,
  x: number,
  y: number,
  onDelete: () => void,
): void {
  const doc = view.state.doc.toString();
  const map = parseDefs(doc);
  const currentId = blockTagId(doc.slice(range.from, range.to));

  // createMenu 当容器（.fn-menu，与原 .switch-menu 同构）；tag-picker 类加到
  // handle.el 保留 .tag-picker .switch-item.active 等祖先选择器样式。
  const handle = createMenu();
  handle.el.classList.add("tag-picker", "tag-block-menu");
  const close = (): void => handle.hide();
  const items: HTMLElement[] = [];

  const label = document.createElement("div");
  label.className = "tag-picker-label";
  label.textContent = "标签";
  items.push(label);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "switch-item tag-picker-clear";
  if (currentId === null) clear.classList.add("active");
  clear.innerHTML = `<i class="ph ph-x"></i> 无标签`;
  clear.onclick = () => {
    close();
    assign(view, range, null);
  };
  items.push(clear);

  for (const def of map.values()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "switch-item tag-picker-item";
    if (def.id === currentId) item.classList.add("active");
    const dot = document.createElement("span");
    dot.className = "tag-disc tag-disc-sm";
    dot.style.setProperty("--c", def.color);
    const name = document.createElement("span");
    name.textContent = def.name;
    item.append(dot, name);
    item.onclick = () => {
      close();
      assign(view, range, def.id);
    };
    items.push(item);
  }

  const createToggle = document.createElement("button");
  createToggle.type = "button";
  createToggle.className = "switch-item tag-create-toggle";
  createToggle.innerHTML = `<i class="ph ph-plus"></i> 新建标签`;
  const divider = document.createElement("div");
  divider.className = "tag-menu-divider";
  createToggle.onclick = () => {
    createToggle.remove();
    handle.el.insertBefore(buildCreateForm(view, range, close), divider);
  };
  items.push(createToggle, divider);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "switch-item tag-context-delete";
  del.innerHTML = `<i class="ph ph-trash"></i> 删除`;
  del.onclick = () => {
    close();
    onDelete();
  };
  items.push(del);

  handle.showAt(x, y, items);
}

function buildCreateForm(view: EditorView, range: BlockRange, close: () => void): HTMLElement {
  const form = document.createElement("div");
  form.className = "tag-create-form";
  const map = parseDefs(view.state.doc.toString());
  const firstAvailable = PALETTE.find((sw) => !isTagColorTaken(map, sw.color));

  const swatchRow = document.createElement("div");
  swatchRow.className = "swatch-row";
  let picked = firstAvailable?.color ?? null;
  const swatches: HTMLElement[] = [];
  for (const sw of PALETTE) {
    const taken = isTagColorTaken(map, sw.color);
    const s = document.createElement("button");
    s.type = "button";
    s.className = "swatch";
    s.style.setProperty("--c", sw.color);
    if (taken) {
      s.classList.add("unavailable");
      s.setAttribute("aria-disabled", "true");
      s.title = "该颜色已被使用";
    }
    if (!taken && sw.color === picked) s.classList.add("selected");
    s.onclick = () => {
      if (taken) return;
      picked = sw.color;
      swatches.forEach((x) => x.classList.toggle("selected", x === s));
    };
    swatches.push(s);
    swatchRow.appendChild(s);
  }
  form.appendChild(swatchRow);

  const input = document.createElement("input");
  input.className = "tag-add-input";
  input.type = "text";
  input.placeholder = firstAvailable ? "标签名" : "颜色已用完";
  input.maxLength = 24;
  input.disabled = !firstAvailable;
  form.appendChild(input);

  const confirm = (): void => {
    const name = input.value.trim();
    if (!name || !picked) return;
    const doc = view.state.doc.toString();
    const { changes } = addTagAndSetBlockChanges(doc, range, name, picked);
    if (changes.length) view.dispatch({ changes });
    close();
  };

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "tag-add-ok";
  ok.textContent = "添加";
  ok.disabled = !firstAvailable;
  ok.onclick = confirm;
  form.appendChild(ok);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); confirm(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  setTimeout(() => input.focus(), 0);
  return form;
}

function assign(view: EditorView, range: BlockRange, id: string | null): void {
  const doc = view.state.doc.toString();
  const change = setBlockTagChange(doc, range, id);
  if (change) view.dispatch({ changes: [change] });
}
