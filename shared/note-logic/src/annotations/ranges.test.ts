import { describe, expect, it } from "vitest";
import {
  addAnnotationRanges,
  mapAnnotations,
  removeAnnotationRanges,
} from "./ranges";
import type { TextAnnotation } from "./types";

function ann(id: string, tagId: string, from: number, to: number): TextAnnotation {
  return { id, tagId, from, to };
}

describe("annotation range normalization", () => {
  it("merges overlapping and adjacent ranges for one tag", () => {
    const result = addAnnotationRanges(
      [ann("old", "idea", 2, 6), ann("other", "verify", 4, 9)],
      "idea",
      [{ from: 6, to: 10 }, { from: 12, to: 14 }, { from: 10, to: 12 }],
      () => "new",
    );
    expect(result).toEqual([
      ann("old", "idea", 2, 14),
      ann("other", "verify", 4, 9),
    ]);
  });

  it("subtracts a selection and splits an existing range", () => {
    expect(removeAnnotationRanges(
      [ann("a", "idea", 2, 12)],
      "idea",
      [{ from: 5, to: 8 }],
      () => "split",
    )).toEqual([
      ann("a", "idea", 2, 5),
      ann("split", "idea", 8, 12),
    ]);
  });

  it("removes empty ranges after deleting all annotated text", () => {
    expect(mapAnnotations(
      [ann("a", "idea", 2, 5)],
      [{ from: 2, to: 5, insert: "" }],
    )).toEqual([]);
  });

  it("keeps insertion at either boundary outside and expands inside", () => {
    const base = [ann("a", "idea", 2, 5)];
    expect(mapAnnotations(base, [{ from: 2, to: 2, insert: "X" }]))
      .toEqual([ann("a", "idea", 3, 6)]);
    expect(mapAnnotations(base, [{ from: 5, to: 5, insert: "X" }]))
      .toEqual([ann("a", "idea", 2, 5)]);
    expect(mapAnnotations(base, [{ from: 3, to: 3, insert: "X" }]))
      .toEqual([ann("a", "idea", 2, 6)]);
  });
});
