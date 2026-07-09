import { describe, expect, it } from "vitest";
import { computeResize, HANDLE_SPECS, type HandleSpec } from "./image-resize";

const spec = (id: HandleSpec["id"]): HandleSpec =>
  HANDLE_SPECS.find((s) => s.id === id) as HandleSpec;

const R = { startW: 400, ratio: 2, maxW: 2000 };

describe("computeResize", () => {
  it("right edge grows rightward, left edge fixed", () => {
    const r = computeResize(spec("e"), { ...R, dx: 50, dy: 0 });
    expect(r.width).toBe(450);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(0);
  });

  it("left edge grows leftward, right edge fixed via translate", () => {
    const r = computeResize(spec("w"), { ...R, dx: 50, dy: 0 });
    expect(r.width).toBe(350);
    expect(r.tx).toBe(50);
    expect(r.ty).toBe(0);
  });

  it("bottom edge grows downward, top fixed", () => {
    const r = computeResize(spec("s"), { ...R, dx: 0, dy: 100 });
    expect(r.width).toBe(600);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(0);
  });

  it("top edge grows upward, bottom fixed via translate", () => {
    const r = computeResize(spec("n"), { ...R, dx: 0, dy: -100 });
    expect(r.width).toBe(600);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(-100);
  });

  it("se corner uses the larger contribution (vertical dominates)", () => {
    const r = computeResize(spec("se"), { ...R, dx: 10, dy: 100 });
    expect(r.width).toBe(600);
    expect(r.tx).toBe(0);
    expect(r.ty).toBe(0);
  });

  it("nw corner uses the larger contribution (vertical dominates) + both translates", () => {
    const r = computeResize(spec("nw"), { ...R, dx: 100, dy: 100 });
    expect(r.width).toBe(200);
    expect(r.tx).toBe(200);
    expect(r.ty).toBe(100);
  });

  it("clamps to maxW on rightward grow", () => {
    const r = computeResize(spec("e"), { ...R, dx: 99999, dy: 0 });
    expect(r.width).toBe(2000);
  });

  it("clamps to MIN_WIDTH on leftward shrink", () => {
    const r = computeResize(spec("w"), { ...R, dx: 99999, dy: 0 });
    expect(r.width).toBe(40);
  });

  it("handles all 8 specs without throwing", () => {
    for (const s of HANDLE_SPECS) {
      const r = computeResize(s, { ...R, dx: 30, dy: 20 });
      expect(r.width).toBeGreaterThanOrEqual(40);
      expect(r.width).toBeLessThanOrEqual(2000);
    }
  });
});
