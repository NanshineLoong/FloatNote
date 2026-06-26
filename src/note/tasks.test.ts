import { describe, it, expect } from "vitest";
import { parseTasks, serializeTasks, toggleTask, addTask, type TaskLine } from "./tasks";

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
