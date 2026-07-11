import { describe, it, expect } from "vitest";
import { clampToScreen, placePopup } from "./clamp";

describe("clampToScreen", () => {
  const screen = { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };

  it("leaves a position unchanged when fully inside", () => {
    expect(clampToScreen(500, 500, 208, 56, screen)).toEqual({ x: 500, y: 500 });
  });

  it("clamps to the right edge", () => {
    const { x, y } = clampToScreen(1900, 500, 208, 56, screen);
    expect(x).toBe(1920 - 208);
    expect(y).toBe(500);
  });

  it("clamps to the bottom edge", () => {
    const { x, y } = clampToScreen(500, 1060, 208, 56, screen);
    expect(x).toBe(500);
    expect(y).toBe(1080 - 56);
  });

  it("clamps a negative cursor on a left-side monitor", () => {
    const leftMonitor = { minX: -1920, minY: 0, maxX: 0, maxY: 1080 };
    const { x, y } = clampToScreen(-2000, 1060, 208, 56, leftMonitor);
    expect(x).toBe(-1920);
    expect(y).toBe(1080 - 56);
  });

  it("clamps a top-left cursor on a negative-origin monitor", () => {
    const leftMonitor = { minX: -1920, minY: -1080, maxX: 0, maxY: 0 };
    const { x, y } = clampToScreen(-2000, -1100, 208, 56, leftMonitor);
    expect(x).toBe(-1920);
    expect(y).toBe(-1080);
  });
});

describe("placePopup", () => {
  const screen = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };

  it("offsets the popup from the selection endpoint", () => {
    expect(placePopup(200, 300, 90, 40, screen)).toEqual({ x: 210, y: 310 });
  });

  it("flips left and above near the bottom-right edge", () => {
    expect(placePopup(990, 790, 90, 40, screen)).toEqual({ x: 890, y: 740 });
  });

  it("still clamps on a negative-origin monitor", () => {
    const left = { minX: -1200, minY: -800, maxX: 0, maxY: 0 };
    expect(placePopup(-1195, -795, 90, 40, left)).toEqual({ x: -1185, y: -785 });
  });
});
