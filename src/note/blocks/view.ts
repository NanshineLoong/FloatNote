import { moveBlock, removeBlock, toggleTodo } from "./ops";
import { parseBlocks, serializeBlocks, type Block } from "./parse";

export interface InboxHost {
  /** Persist new inbox markdown. Wired to CodeMirror's setDoc so autosave +
   * the assistant's note text stay in sync; the view never touches disk itself. */
  setDoc: (md: string) => void;
}

export interface InboxView {
  /** (Re)render from the given markdown. Call on open and after external writes. */
  render: (md: string) => void;
}

export function createInboxView(parent: HTMLElement, host: InboxHost): InboxView {
  let blocks: Block[] = [];

  function commit(next: Block[]) {
    blocks = next;
    host.setDoc(serializeBlocks(blocks));
    draw();
  }

  function render(md: string) {
    blocks = parseBlocks(md);
    draw();
  }

  function draw() {
    parent.replaceChildren();
    const list = document.createElement("div");
    list.className = "inbox-list";
    blocks.forEach((block, index) => list.appendChild(renderCard(block, index)));
    if (blocks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "inbox-empty";
      empty.textContent = "Inbox 还是空的 —— 划线捕获或在源码模式里写点什么。";
      list.appendChild(empty);
    }
    parent.appendChild(list);
    wireDrag(list);
  }

  function renderCard(block: Block, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `inbox-row inbox-${block.kind}`;
    row.dataset.index = String(index);

    const handle = document.createElement("button");
    handle.className = "inbox-handle";
    handle.title = "拖动重排";
    handle.innerHTML = `<i class="ph ph-dots-six-vertical"></i>`;
    row.appendChild(handle);

    row.appendChild(renderBody(block, index));

    const del = document.createElement("button");
    del.className = "inbox-del";
    del.title = "删除";
    del.innerHTML = `<i class="ph ph-x"></i>`;
    del.onclick = () => commit(removeBlock(blocks, index));
    row.appendChild(del);

    return row;
  }

  function renderBody(block: Block, index: number): HTMLElement {
    const body = document.createElement("div");
    body.className = "inbox-body";

    if (block.kind === "todo") {
      const label = document.createElement("label");
      label.className = "inbox-todo";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = block.checked;
      box.onchange = () => commit(toggleTodo(blocks, index));
      const text = document.createElement("span");
      text.className = "inbox-todo-text";
      text.textContent = block.text || "（空待办）";
      label.append(box, text);
      body.appendChild(label);
      return body;
    }

    if (block.kind === "callout") {
      const card = document.createElement("div");
      card.className = "inbox-card inbox-callout-card";
      const title = document.createElement("div");
      title.className = "inbox-callout-title";
      title.textContent = block.title || block.calloutType;
      const text = document.createElement("div");
      text.className = "inbox-callout-body";
      text.textContent = block.body.join("\n");
      card.append(title, text);
      body.appendChild(card);
      return body;
    }

    const card = document.createElement("div");
    card.className =
      block.kind === "quote" ? "inbox-card inbox-quote-card" : "inbox-card inbox-text-card";
    card.textContent = block.lines.join("\n");
    body.appendChild(card);
    return body;
  }

  // Pointer-based reorder: drag the handle, translate the row, compute the drop
  // index by how many row midpoints sit above the pointer, commit on release.
  function wireDrag(list: HTMLElement) {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".inbox-row"));
    list.querySelectorAll<HTMLElement>(".inbox-handle").forEach((handle, from) => {
      handle.onpointerdown = (event) => {
        event.preventDefault();
        const dragged = rows[from];
        const startY = event.clientY;
        const indicator = document.createElement("div");
        indicator.className = "inbox-drop-indicator";
        handle.setPointerCapture(event.pointerId);
        dragged.classList.add("inbox-dragging");
        let to = from;

        const onMove = (move: PointerEvent) => {
          dragged.style.transform = `translateY(${move.clientY - startY}px)`;
          to = rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top + rect.height / 2 < move.clientY;
          }).length;
          const ref = rows[to] ?? null;
          if (ref === dragged) {
            indicator.remove();
          } else {
            list.insertBefore(indicator, ref);
          }
        };

        const onUp = () => {
          handle.releasePointerCapture(event.pointerId);
          handle.onpointermove = null;
          handle.onpointerup = null;
          indicator.remove();
          dragged.classList.remove("inbox-dragging");
          dragged.style.transform = "";
          if (to !== from && to !== from + 1) {
            commit(moveBlock(blocks, from, to));
          }
        };

        handle.onpointermove = onMove;
        handle.onpointerup = onUp;
      };
    });
  }

  return { render };
}
