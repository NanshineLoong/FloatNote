import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("selection popup window lifecycle", () => {
  it("never asks Tauri to focus the passive popup", () => {
    expect(source).not.toContain(".setFocus(");
  });

  it("submits on the button's first click", () => {
    expect(source).toContain('captureBtn.addEventListener("click"');
    expect(source).toContain('invoke("submit_popup_capture"');
  });

  it("resizes from measured content instead of fixed constants", () => {
    expect(source).toContain("getBoundingClientRect");
    expect(source).toContain("setSize");
    expect(source).not.toContain("POPUP_W");
    expect(source).not.toContain("POPUP_H");
  });

  it("defensively suppresses empty automatic payloads", () => {
    expect(source).toContain('payload.origin === "auto" && !payload.hasText');
  });

  it("synchronizes the question input interaction mode with the backend", () => {
    expect(source).toContain('invoke("set_popup_interaction_mode"');
    expect(source).toContain("if (state?.generationId === generationId) showToast");
  });

  it("uses the popup keyboard policy before sending a question from Enter", () => {
    expect(source).toContain("shouldSendPopupQuestion");
  });

  it("does not deactivate an already-completed session before showing a sent warning", () => {
    const sentBranch = source.match(/if \(result\.sent\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
    expect(sentBranch).not.toContain("setInteractionMode");
  });
});
