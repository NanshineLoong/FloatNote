export type TaskLine =
  | { kind: "todo"; checked: boolean; text: string }
  | { kind: "raw"; text: string };

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/;

export function parseTasks(md: string): TaskLine[] {
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = TODO_RE.exec(line);
      if (m) return { kind: "todo", checked: m[1] !== " ", text: m[2] ?? "" } as TaskLine;
      return { kind: "raw", text: line } as TaskLine;
    });
}

export function serializeTasks(items: TaskLine[]): string {
  return items
    .map((item) =>
      item.kind === "todo"
        ? `- [${item.checked ? "x" : " "}]${item.text ? ` ${item.text}` : ""}`
        : item.text,
    )
    .join("\n");
}

export function toggleTask(items: TaskLine[], index: number): TaskLine[] {
  const item = items[index];
  if (!item || item.kind !== "todo") return items;
  return items.map((it, i) => (i === index ? { ...item, checked: !item.checked } : it));
}

export function addTask(items: TaskLine[], text: string): TaskLine[] {
  const trimmed = text.trim();
  if (!trimmed) return items;
  return [...items, { kind: "todo", checked: false, text: trimmed }];
}

export function deleteTask(items: TaskLine[], index: number): TaskLine[] {
  if (index < 0 || index >= items.length) return items;
  return items.filter((_, i) => i !== index);
}

/** 把 from 处的项移到 to 处（真实数组索引，含 raw 行）。越界或同位时原样返回。 */
export function reorderTask(items: TaskLine[], from: number, to: number): TaskLine[] {
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  if (from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 原地重命名指定 todo（只对 todo 生效，raw 行忽略）。空文本原样返回。 */
export function renameTask(items: TaskLine[], index: number, text: string): TaskLine[] {
  const trimmed = text.trim();
  if (!trimmed) return items;
  const item = items[index];
  if (!item || item.kind !== "todo") return items;
  return items.map((it, i) => (i === index ? { ...item, text: trimmed } : it));
}
