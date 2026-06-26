import { describe, it, expect } from "vitest";
import { moveBlock, removeBlock, toggleTodo } from "./ops";
import type { Block } from "./parse";

const a: Block = { kind: "text", lines: ["a"] };
const b: Block = { kind: "text", lines: ["b"] };
const c: Block = { kind: "text", lines: ["c"] };

describe("moveBlock", () => {
  it("moves an item toward the end (to = insertion index in the original array)", () => {
    expect(moveBlock([a, b, c], 0, 3)).toEqual([b, c, a]);
  });

  it("moves an item toward the front", () => {
    expect(moveBlock([a, b, c], 2, 0)).toEqual([c, a, b]);
  });

  it("inserting before a later sibling lands just before it", () => {
    expect(moveBlock([a, b, c], 0, 2)).toEqual([b, a, c]);
  });

  it("is a no-op when the position does not change", () => {
    expect(moveBlock([a, b, c], 1, 1)).toEqual([a, b, c]);
    expect(moveBlock([a, b, c], 1, 2)).toEqual([a, b, c]);
  });
});

describe("removeBlock", () => {
  it("removes the block at the given index", () => {
    expect(removeBlock([a, b, c], 1)).toEqual([a, c]);
  });
});

describe("toggleTodo", () => {
  it("flips a todo's checked state immutably", () => {
    const todo: Block = { kind: "todo", checked: false, text: "x" };
    const input = [todo];
    expect(toggleTodo(input, 0)).toEqual([{ kind: "todo", checked: true, text: "x" }]);
    expect(input[0]).toEqual({ kind: "todo", checked: false, text: "x" });
  });

  it("leaves non-todo blocks unchanged", () => {
    expect(toggleTodo([a], 0)).toEqual([a]);
  });
});
