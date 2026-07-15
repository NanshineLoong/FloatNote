import { describe, expect, it } from "vitest";
import { annotationCoverage } from "./menu";

describe("annotationCoverage", () => {
  const annotations = [
    { id: "a", tagId: "idea", from: 0, to: 5 },
    { id: "b", tagId: "idea", from: 8, to: 10 },
  ];

  it("distinguishes checked, mixed, and unchecked selections", () => {
    expect(annotationCoverage(annotations, "idea", [{ from: 1, to: 4 }])).toBe("checked");
    expect(annotationCoverage(annotations, "idea", [{ from: 4, to: 7 }])).toBe("mixed");
    expect(annotationCoverage(annotations, "idea", [{ from: 6, to: 7 }])).toBe("unchecked");
  });
});
