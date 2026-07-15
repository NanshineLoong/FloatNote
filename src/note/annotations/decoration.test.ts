import { describe, expect, it } from "vitest";
import { annotationSpans } from "./decoration";

describe("annotationSpans", () => {
  it("keeps overlapping colors separate in tag-definition order", () => {
    const spans = annotationSpans({
      tags: [
        { id: "blue", name: "Blue", color: "#3b82f6" },
        { id: "orange", name: "Orange", color: "#f5a623" },
      ],
      annotations: [
        { id: "a", tagId: "orange", from: 3, to: 8 },
        { id: "b", tagId: "blue", from: 0, to: 5 },
      ],
      quoteSources: [],
    });
    expect(spans).toEqual([
      { from: 0, to: 3, colors: ["#3b82f6"], names: ["Blue"] },
      { from: 3, to: 5, colors: ["#3b82f6", "#f5a623"], names: ["Blue", "Orange"] },
      { from: 5, to: 8, colors: ["#f5a623"], names: ["Orange"] },
    ]);
  });
});
