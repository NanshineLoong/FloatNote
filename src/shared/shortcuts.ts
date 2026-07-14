/**
 * 快捷键共享纯函数：键位默认值、KeyboardEvent→组合串、归一化、冲突检测。
 * 设置页（录制+冲突提示）与笔记窗（中央分派）共用，避免逻辑重复。
 */

const isMac =
  typeof navigator !== "undefined" && navigator.platform
    ? navigator.platform.toUpperCase().indexOf("MAC") >= 0
    : false;

export type WindowShortcutId =
  | "assistant"
  | "assistant_bubble"
  | "action_panel"
  | "add_action"
  | "new_conversation"
  | "view_inbox"
  | "view_piece"
  | "view_split";

export const WINDOW_SHORTCUT_IDS: WindowShortcutId[] = [
  "assistant",
  "assistant_bubble",
  "action_panel",
  "add_action",
  "new_conversation",
  "view_inbox",
  "view_piece",
  "view_split",
];

export const WINDOW_SHORTCUT_DEFAULTS: Record<WindowShortcutId, string> = {
  assistant: "Cmd+J",
  assistant_bubble: "Cmd+B",
  action_panel: "Cmd+T",
  add_action: "Cmd+G",
  new_conversation: "Cmd+K",
  view_inbox: "Cmd+1",
  view_piece: "Cmd+2",
  view_split: "Cmd+3",
};

export const WINDOW_SHORTCUT_LABELS: Record<WindowShortcutId, string> = {
  assistant: "切换 AI 助手",
  assistant_bubble: "切换 AI 对话气泡",
  action_panel: "切换行动面板",
  add_action: "添加下一项行动",
  new_conversation: "新对话",
  view_inbox: "视图·采集",
  view_piece: "视图·写作",
  view_split: "视图·双栏",
};

function keyName(key: string): string {
  switch (key) {
    case "Meta": return isMac ? "Cmd" : "Win";
    case "Control": return "Ctrl";
    case "Alt": return "Alt";
    case "Shift": return "Shift";
    case " ": return "Space";
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** KeyboardEvent → "Cmd+J" 格式；无修饰键或仅修饰键按下返回 null。 */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push(isMac ? "Cmd" : "Win");
  if (mods.length === 0) return null;
  mods.push(keyName(e.key));
  return mods.join("+");
}

/** "Cmd+J" → "Mod+J"（Cmd/Win/Ctrl/Meta 归一 Mod，字母大写，修饰键顺序 Shift,Alt,Mod）。 */
export function canonicalize(combo: string): string {
  const mods = new Set<string>();
  let main = "";
  for (const part of combo.split("+")) {
    if (part === "Mod" || part === "Cmd" || part === "Win" || part === "Ctrl" || part === "Meta") {
      mods.add("Mod");
    } else if (part === "Alt") {
      mods.add("Alt");
    } else if (part === "Shift") {
      mods.add("Shift");
    } else {
      main = part.length === 1 ? part.toUpperCase() : part;
    }
  }
  const out: string[] = [];
  for (const m of ["Shift", "Alt", "Mod"]) {
    if (mods.has(m)) out.push(m);
  }
  if (main) out.push(main);
  return out.join("+");
}

interface ReservedEntry {
  combo: string;
  reason: string;
}

const RAW_RESERVED: ReservedEntry[] = [
  // CodeMirror defaultKeymap + historyKeymap 占用（实测 editor.ts:50）
  { combo: "Mod+A", reason: "与编辑器「全选」冲突" },
  { combo: "Mod+I", reason: "与编辑器快捷键冲突" },
  { combo: "Mod+U", reason: "与编辑器「选区撤销」冲突" },
  { combo: "Mod+Shift+U", reason: "与编辑器「选区重做」冲突" },
  { combo: "Mod+Y", reason: "与编辑器「重做」冲突" },
  { combo: "Mod+Z", reason: "与编辑器「撤销」冲突" },
  { combo: "Mod+Shift+Z", reason: "与编辑器「重做」冲突" },
  { combo: "Mod+[", reason: "与编辑器「减少缩进」冲突" },
  { combo: "Mod+]", reason: "与编辑器「增加缩进」冲突" },
  { combo: "Mod+/", reason: "与编辑器「注释」冲突" },
  { combo: "Mod+Enter", reason: "与编辑器快捷键冲突" },
  { combo: "Shift+Mod+K", reason: "与编辑器快捷键冲突" },
  // 系统/平台保留
  { combo: "Mod+Q", reason: "与系统「退出」冲突" },
  { combo: "Mod+W", reason: "与系统「关闭窗口」冲突" },
  { combo: "Mod+M", reason: "与系统「最小化」冲突" },
  { combo: "Mod+H", reason: "与系统「隐藏」冲突" },
  { combo: "Mod+N", reason: "与系统「新窗口」冲突" },
  { combo: "Mod+R", reason: "与系统「刷新」冲突" },
  // 复制粘贴
  { combo: "Mod+C", reason: "与「复制」冲突" },
  { combo: "Mod+V", reason: "与「粘贴」冲突" },
  { combo: "Mod+X", reason: "与「剪切」冲突" },
];

const RESERVED_MAP = new Map<string, string>(
  RAW_RESERVED.map((r) => [canonicalize(r.combo), r.reason]),
);

export interface ConflictInput {
  combo: string;
  id: WindowShortcutId;
  all: Record<WindowShortcutId, string>;
  globals: { capture: string; toggle: string; popup: string };
}

export interface ConflictResult {
  kind: "reserved" | "window" | "global";
  message: string;
}

export function checkConflict(input: ConflictInput): ConflictResult | null {
  const c = canonicalize(input.combo);
  const reserved = RESERVED_MAP.get(c);
  if (reserved) return { kind: "reserved", message: reserved };
  for (const id of WINDOW_SHORTCUT_IDS) {
    if (id === input.id) continue;
    if (input.all[id] && canonicalize(input.all[id]) === c) {
      return { kind: "window", message: `与「${WINDOW_SHORTCUT_LABELS[id]}」重复` };
    }
  }
  const labels: Array<[string, string]> = [
    [input.globals.capture, "划线引用"],
    [input.globals.toggle, "显示/隐藏"],
    [input.globals.popup, "划词弹窗"],
  ];
  for (const [combo, label] of labels) {
    if (combo && canonicalize(combo) === c) {
      return { kind: "global", message: `与全局快捷键「${label}」重复（窗口聚焦时会双重触发）` };
    }
  }
  return null;
}

export function findAllConflicts(
  all: Record<WindowShortcutId, string>,
  globals: { capture: string; toggle: string; popup: string },
): Partial<Record<WindowShortcutId, ConflictResult>> {
  const out: Partial<Record<WindowShortcutId, ConflictResult>> = {};
  for (const id of WINDOW_SHORTCUT_IDS) {
    const r = checkConflict({ combo: all[id], id, all, globals });
    if (r) out[id] = r;
  }
  return out;
}

export type ShortcutFieldId = WindowShortcutId | "capture" | "toggle" | "popup";

export function findShortcutConflicts(
  all: Record<WindowShortcutId, string>,
  globals: { capture: string; toggle: string; popup: string },
): Partial<Record<ShortcutFieldId, ConflictResult>> {
  const conflicts: Partial<Record<ShortcutFieldId, ConflictResult>> = findAllConflicts(all, globals);
  const globalLabels = { capture: "划线引用", toggle: "显示 / 隐藏", popup: "唤起划词弹窗" };
  for (const globalId of ["capture", "toggle", "popup"] as const) {
    const value = globals[globalId];
    const reserved = RESERVED_MAP.get(canonicalize(value));
    if (reserved) {
      conflicts[globalId] = { kind: "reserved", message: reserved };
      continue;
    }
    for (const windowId of WINDOW_SHORTCUT_IDS) {
      if (canonicalize(all[windowId]) === canonicalize(value)) {
        conflicts[globalId] = { kind: "window", message: `与「${WINDOW_SHORTCUT_LABELS[windowId]}」重复` };
        conflicts[windowId] = {
          kind: "global",
          message: `与全局快捷键「${globalLabels[globalId]}」重复（窗口聚焦时会双重触发）`,
        };
      }
    }
    for (const otherId of ["capture", "toggle", "popup"] as const) {
      if (otherId !== globalId && canonicalize(globals[otherId]) === canonicalize(value)) {
        conflicts[globalId] = { kind: "global", message: `与「${globalLabels[otherId]}」重复` };
      }
    }
  }
  return conflicts;
}
