import { describe, it, expect } from "vitest";
import { parseTasks, serializeTasks, toggleTask, addTask, deleteTask, reorderTask, renameTask, type TaskLine } from "./tasks";

describe("parseTasks", () => {
  it("parses checked + unchecked todos, one per line", () => {
    expect(parseTasks("- [ ] 写提纲\n- [x] 收集资料")).toEqual([
      { kind: "todo", checked: false, text: "写提纲" },
      { kind: "todo", checked: true, text: "收集资料" },
    ]);
  });

  it("keeps non-todo lines as raw, normalizing CRLF and dropping blank lines", () => {
    expect(parseTasks("# 标题\r\n\r\n- [ ] a")).toEqual([
      { kind: "raw", text: "# 标题" },
      { kind: "todo", checked: false, text: "a" },
    ]);
  });
});

describe("serializeTasks", () => {
  it("round-trips a mixed checklist", () => {
    const md = "# 标题\n- [ ] a\n- [x] b";
    expect(serializeTasks(parseTasks(md))).toBe(md);
  });

  it("serializes an empty list to an empty string", () => {
    expect(serializeTasks([])).toBe("");
  });
});

describe("toggleTask", () => {
  it("flips only the targeted todo, immutably", () => {
    const items: TaskLine[] = [{ kind: "todo", checked: false, text: "a" }];
    expect(toggleTask(items, 0)).toEqual([{ kind: "todo", checked: true, text: "a" }]);
    expect(items[0]).toEqual({ kind: "todo", checked: false, text: "a" });
  });

  it("ignores raw lines", () => {
    const items: TaskLine[] = [{ kind: "raw", text: "x" }];
    expect(toggleTask(items, 0)).toEqual(items);
  });
});

describe("addTask", () => {
  it("appends a new unchecked todo", () => {
    expect(addTask([], "新任务")).toEqual([{ kind: "todo", checked: false, text: "新任务" }]);
  });

  it("ignores blank input", () => {
    expect(addTask([], "   ")).toEqual([]);
  });
});

describe("deleteTask", () => {
  it("removes the targeted item, immutably", () => {
    const items: TaskLine[] = [
      { kind: "todo", checked: false, text: "a" },
      { kind: "todo", checked: true, text: "b" },
    ];
    expect(deleteTask(items, 0)).toEqual([{ kind: "todo", checked: true, text: "b" }]);
    expect(items).toHaveLength(2);
  });

  it("returns the list unchanged for an out-of-range index", () => {
    const items: TaskLine[] = [{ kind: "todo", checked: false, text: "a" }];
    expect(deleteTask(items, 5)).toBe(items);
  });
});

describe("reorderTask", () => {
  it("moves an item from one position to another", () => {
    const items: TaskLine[] = [
      { kind: "todo", checked: false, text: "a" },
      { kind: "todo", checked: false, text: "b" },
      { kind: "todo", checked: false, text: "c" },
    ];
    expect(reorderTask(items, 0, 2)).toEqual([
      { kind: "todo", checked: false, text: "b" },
      { kind: "todo", checked: false, text: "c" },
      { kind: "todo", checked: false, text: "a" },
    ]);
    expect(items).toHaveLength(3);
  });

  it("returns the list unchanged for same index or out-of-range", () => {
    const items: TaskLine[] = [{ kind: "todo", checked: false, text: "a" }];
    expect(reorderTask(items, 0, 0)).toBe(items);
    expect(reorderTask(items, 0, 5)).toBe(items);
  });
});

describe("renameTask", () => {
  it("renames the targeted todo, immutably, trimming whitespace", () => {
    const items: TaskLine[] = [{ kind: "todo", checked: false, text: "a" }];
    expect(renameTask(items, 0, "  新名字  ")).toEqual([
      { kind: "todo", checked: false, text: "新名字" },
    ]);
    expect(items[0]).toEqual({ kind: "todo", checked: false, text: "a" });
  });

  it("ignores raw lines and blank input", () => {
    const items: TaskLine[] = [{ kind: "raw", text: "x" }];
    expect(renameTask(items, 0, "y")).toBe(items);
    expect(renameTask(items, 0, "   ")).toBe(items);
  });
});
