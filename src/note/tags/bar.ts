/**
 * Secondary tag control bar — lives in the capture area's top grid row (not the
 * global topbar, which is shared across inbox/piece/split). It is a filter rail only:
 *   [全部]  ● ● ● …
 * Tag creation lives in the block-handle menu so new labels are born from a
 * specific block instead of as empty global state.
 *
 * The bar is a thin view over the doc: `refresh()` re-reads `_inbox.md` and
 * re-renders. main.ts calls it on every editor update.
 */
import { type EditorView } from "@codemirror/view";
import {
  deleteTagChanges,
  isTagColorTaken,
  parseDefs,
  patchTagDefChange,
  type TagDef,
} from "@floatnote/note-logic";
import { PALETTE } from "./palette";
import { activeTagFilter, setTagFilterEffect } from "./filter";
import { showToast } from "../../shared/toast";
import { createMenu } from "../../shared/ui/menu";

export interface TagBarHandle {
  el: HTMLElement;
  refresh: () => void;
}

export function mountTagBar(view: EditorView): TagBarHandle {
  const el = document.createElement("div");
  el.className = "tag-bar";

  const allButton = document.createElement("button");
  allButton.className = "tag-filter-all";
  allButton.type = "button";
  allButton.innerHTML = `<i class="ph ph-squares-four"></i><span>全部</span>`;
  allButton.title = "显示全部";
  allButton.onclick = () => setTagFilterEffect(view, null);

  const discRow = document.createElement("div");
  discRow.className = "tag-disc-row";

  const readonlyHint = document.createElement("div");
  readonlyHint.className = "tag-readonly-hint";
  readonlyHint.innerHTML = `<i class="ph ph-lock"></i><span>只读视图</span>`;
  readonlyHint.hidden = true;

  el.appendChild(allButton);
  el.appendChild(discRow);
  el.appendChild(readonlyHint);

  // The disc set only changes when line 1 (the defs comment) or the active
  // filter changes — body edits leave both untouched. Cache on those two and
  // skip the full DOM rebuild on every keystroke.
  let lastLine1 = "";
  let lastActive: string | null | undefined = undefined; // sentinel: never matched
  const refresh = (): void => {
    const doc = view.state.doc.toString();
    const nl = doc.indexOf("\n");
    const line1 = nl === -1 ? doc : doc.slice(0, nl);
    const active = activeTagFilter(view.state);
    if (line1 === lastLine1 && active === lastActive) return;
    lastLine1 = line1;
    lastActive = active;

    const map = parseDefs(line1);
    allButton.classList.toggle("active", active === null);
    readonlyHint.hidden = active === null;
    view.dom.parentElement?.classList.toggle("tag-filter-readonly", active !== null);
    discRow.innerHTML = "";
    for (const def of map.values()) {
      discRow.appendChild(buildDisc(view, def, def.id === active));
    }
  };

  refresh();
  return { el, refresh };
}

function buildDisc(view: EditorView, def: TagDef, active: boolean): HTMLElement {
  const disc = document.createElement("button");
  disc.type = "button";
  disc.className = "tag-disc tag-filter-disc";
  if (active) disc.classList.add("active");
  disc.style.setProperty("--c", def.color);
  disc.ariaLabel = def.name;
  const dot = document.createElement("span");
  dot.className = "tag-filter-dot";
  dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "tag-filter-name";
  name.textContent = def.name;
  disc.append(dot, name);
  disc.onclick = (e) => {
    e.stopPropagation();
    const cur = activeTagFilter(view.state);
    setTagFilterEffect(view, nextTagFilter(cur, def.id));
  };
  disc.oncontextmenu = (e) => {
    e.preventDefault();
    openContextMenu(view, def, e.clientX, e.clientY);
  };
  return disc;
}

export function nextTagFilter(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

// ── edit popover (rename / recolor / delete) ────────────────────────────────

function openContextMenu(view: EditorView, def: TagDef, x: number, y: number): void {
  // createMenu 当容器（.fn-menu，与原 .switch-menu 同构）；保留 tag-context-menu /
  // tag-edit-popover hook 类供识别。
  const handle = createMenu();
  handle.el.classList.add("tag-context-menu", "tag-edit-popover");
  const close = (): void => handle.hide();

  const input = document.createElement("input");
  input.className = "tag-add-input";
  input.type = "text";
  input.value = def.name;
  input.maxLength = 24;

  const row = document.createElement("div");
  row.className = "swatch-row";
  for (const sw of PALETTE) {
    const doc = view.state.doc.toString();
    const map = parseDefs(doc);
    const taken = isTagColorTaken(map, sw.color, def.id);
    const s = document.createElement("button");
    s.type = "button";
    s.className = "swatch";
    s.style.setProperty("--c", sw.color);
    if (taken) {
      s.classList.add("unavailable");
      s.setAttribute("aria-disabled", "true");
      s.title = "该颜色已被使用";
    }
    if (sw.color === def.color) s.classList.add("selected");
    s.onclick = () => {
      if (taken) return;
      const doc = view.state.doc.toString();
      const change = patchTagDefChange(doc, def.id, { color: sw.color });
      if (change) view.dispatch({ changes: [change] });
      close();
    };
    row.appendChild(s);
  }

  const commitName = (): void => {
    const name = input.value.trim();
    if (!name || name === def.name) return;
    const doc = view.state.doc.toString();
    const change = patchTagDefChange(doc, def.id, { name });
    if (change) view.dispatch({ changes: [change] });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitName(); close(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  input.addEventListener("blur", commitName);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "switch-item tag-context-delete";
  del.innerHTML = `<i class="ph ph-trash"></i> 删除`;
  del.onclick = () => {
    const doc = view.state.doc.toString();
    const changes = deleteTagChanges(doc, def.id);
    if (changes.length) view.dispatch({ changes });
    if (activeTagFilter(view.state) === def.id) setTagFilterEffect(view, null);
    showToast(`已删除标签「${def.name}」，⌘Z 撤销`);
    close();
  };

  handle.showAt(x, y, [input, row, del]);
  input.focus();
  input.select();
}
