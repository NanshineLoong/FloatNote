import { describe, expect, it, vi } from "vitest";
import { requestEditorLayout } from "./editor";

describe("requestEditorLayout", () => {
  it("requests a CodeMirror measurement on the next frame", () => {
    const requestMeasure = vi.fn();
    const schedule = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    requestEditorLayout({ requestMeasure }, schedule);

    expect(schedule).toHaveBeenCalledOnce();
    expect(requestMeasure).toHaveBeenCalledOnce();
  });
});
